/**
 * Cave carving — and the water-floor guard.
 *
 * This module implements the current cave-carving policy.
 *
 * ---------------------------------------------------------------------------
 * CORRECTION TO plan.md §3.7
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.7 says:
 *
 *     カーバーが川/湖の底をくり抜くと「浮いた水面 + 真っ暗な空洞」になる
 *     (参照実装の重大バグ)。水域の床マージン検査を最初から入れる
 *
 * The bug is real and the instruction is right, but the parenthetical is out of
 * date: **the reference implementation already fixed it, and the fix is
 * regression-tested there.** This is therefore not a bug to avoid inventing —
 * it is a fix to port, and it is the most valuable thing in the carver.
 *
 * Reference, `packages/world/domain/terrain/cave-carver.ts:70-74`:
 *
 *     // Keep a solid shell under water bodies: carving the bed away leaves a
 *     // floating water sheet over an unlit cavity (the black-void bug).
 *     if (waterFloorY >= 0 && y >= waterFloorY - CAVE_WATER_FLOOR_MARGIN && y < waterFloorY) {
 *       continue
 *     }
 *
 * supported by `computeWaterFloorYs` (`cave-carver.ts:18-32`), pinned by
 * `packages/world/test/cave-carver.test.ts:201` ("keeps a solid floor shell
 * under water bodies (hollow-lake regression)").
 *
 * ---------------------------------------------------------------------------
 * The subtle half: a biome check is NOT sufficient
 * ---------------------------------------------------------------------------
 *
 * The ravine carver has the same guard in two layers, and its comments record
 * that the first layer alone was the buggy version —
 * `packages/world/domain/terrain/ravine-carver.ts:41-46`:
 *
 *     // Water bodies keep their beds — vanilla surface ravines don't slice rivers open.
 *     if (state.biome === 'OCEAN' || state.biome === 'RIVER') continue
 *     // Same rule for ANY submerged column (lakes, flooded basins): the biome check
 *     // alone let ravines carve lake beds from under their water, leaving a floating
 *     // water sheet over a dark shaft ("hollow lake" black-void bug).
 *     if (blocks[...surfaceY + 1...] === waterBlockIndex) continue
 *
 * A lake sitting in a `PLAINS` basin is submerged but is not an ocean or a
 * river biome, so the biome test misses it entirely. The guard must probe the
 * actual blocks. That is why `computeWaterFloorYs` below scans the buffer
 * rather than consulting the biome map.
 *
 * ---------------------------------------------------------------------------
 * Why the margin is a parameter
 * ---------------------------------------------------------------------------
 *
 * Both public carving entry points reject zero and every other non-positive,
 * non-finite, or non-integer margin. The zero-margin regression uses the
 * `./testing` export, which is excluded from the package root.
 */
import { Brand, Data, Option, Result } from 'effect'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, WATER_FLOOR_MARGIN, blockIndex } from './constants.js'
import { type NoiseFn3D, type NoiseSeed, createNoiseField } from '@nerima-games/mc-noise'
import { worldX, worldZ } from './generator-coordinates.js'
import { BLOCK } from './biome.js'
import type { ChunkCoord } from '@nerima-games/mc-kernel'
import { channelSeed } from './noise-compatibility.js'
import { readBlock } from './chunk.js'

/** Vertical band caves may occupy. Above bedrock, below the surface layer. */
export const CAVE_FLOOR_Y = 6
export const CAVE_CEILING_Y = 58

/** Above this noise value a voxel is carved. Higher = fewer caves. */
export const CAVE_THRESHOLD = 0.62

/** Sentinel meaning "this column holds no water" — see `computeWaterFloorYs`. */
const NO_WATER_FLOOR = -1
const NO_SURFACE_Y = -1

/** Single-block iteration step for the per-voxel scans below. */
const AXIS_STEP = 1

/** Converts a block count (`CHUNK_HEIGHT`) into the highest valid Y index. */
const TOP_Y_INDEX_OFFSET = 1

/**
 * Extra vertical headroom scanned above the margin-padded ceiling, so a water
 * body whose bed sits just above that padding is still detected.
 */
const WATER_FLOOR_SCAN_HEADROOM = 16

type IndexedValues<Value> = {
  readonly [index: number]: Value
}

const readRequired = <Value>(values: IndexedValues<Value>, index: number): Value => Option.getOrThrow(Option.fromNullishOr(values[index]))

/** Horizontal cave wavelength in blocks. */
const CAVE_NOISE_XZ_WAVELENGTH_BLOCKS = 40

/** Vertical cave wavelength in blocks. */
const CAVE_NOISE_Y_WAVELENGTH_BLOCKS = 20

/** Keep three exposed solid blocks above dry caves to limit surface openings. */
const CAVE_SURFACE_MARGIN_BLOCKS = 3
const MIN_WATER_FLOOR_MARGIN = 1
const TEST_WATER_FLOOR_MARGIN = 0

const CAVE_NOISE_FREQUENCY_NUMERATOR = 1
const CAVE_NOISE_XZ_FREQUENCY = CAVE_NOISE_FREQUENCY_NUMERATOR / CAVE_NOISE_XZ_WAVELENGTH_BLOCKS
const CAVE_NOISE_Y_FREQUENCY = CAVE_NOISE_FREQUENCY_NUMERATOR / CAVE_NOISE_Y_WAVELENGTH_BLOCKS

export type CarveOptions = {
  /**
   * Solid blocks to preserve beneath the lowest water block in a column.
   * Defaults to `WATER_FLOOR_MARGIN` (3, matching the reference). Public APIs
   * require a positive finite integer.
   */
  readonly waterFloorMargin?: number
}

const taggedError = Data.TaggedError

type InvalidWaterFloorMarginFields = { readonly field: 'waterFloorMargin' }

export const InvalidWaterFloorMargin: new (
  args: InvalidWaterFloorMarginFields,
) => Error & { readonly _tag: 'InvalidWaterFloorMargin' } & Readonly<InvalidWaterFloorMarginFields> =
  taggedError('InvalidWaterFloorMargin')<InvalidWaterFloorMarginFields>

export type InvalidWaterFloorMargin = InstanceType<typeof InvalidWaterFloorMargin>

export type ValidatedWaterFloorMargin = number & Brand.Brand<'ValidatedWaterFloorMargin'>
const waterFloorMarginFromNumber = Brand.nominal<ValidatedWaterFloorMargin>()

export const validateWaterFloorMargin = (margin: unknown): Result.Result<ValidatedWaterFloorMargin, InvalidWaterFloorMargin> => {
  if (
    typeof margin !== 'number' ||
    !Number.isFinite(margin) ||
    !Number.isInteger(margin) ||
    margin < MIN_WATER_FLOOR_MARGIN
  ) {
    return Result.fail(new InvalidWaterFloorMargin({ field: 'waterFloorMargin' }))
  }
  return Result.succeed(waterFloorMarginFromNumber(margin))
}

/**
 * Lowest water block in each column, or `-1` where the column holds no water.
 *
 * The scan deliberately reaches above `CAVE_CEILING_Y` by the margin, so a
 * water body whose bed sits just above the carving band is still protected. The
 * reference does the same and says why — `cave-carver.ts:20`:
 * `const scanTop = CAVE_CEILING + CAVE_WATER_FLOOR_MARGIN`.
 */
export const computeWaterFloorYs = (blocks: Uint16Array, margin: number): Int16Array => {
  const floors = new Int16Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ).fill(NO_WATER_FLOOR)
  const scanTop = Math.min(CHUNK_HEIGHT - TOP_Y_INDEX_OFFSET, CAVE_CEILING_Y + margin + WATER_FLOOR_SCAN_HEADROOM)

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      for (let y = 0; y <= scanTop; y += AXIS_STEP) {
        if (readBlock(blocks, blockIndex(lx, y, lz)) === BLOCK.WATER) {
          floors[lz * CHUNK_SIZE_XZ + lx] = y
          break
        }
      }
    }
  }

  return floors
}

/** Whether `y` sits in the solid shell this file's header keeps under a water body. */
const isWithinWaterFloorShell = (y: number, waterFloorY: number, margin: number): boolean =>
  waterFloorY !== NO_WATER_FLOOR && y >= waterFloorY - margin && y < waterFloorY

/** Clears one voxel, unless it is one of the blocks a cave must never remove. */
const carveVoxelIfClearable = (blocks: Uint16Array, index: number): void => {
  const current = readBlock(blocks, index)

  if (current === BLOCK.AIR || current === BLOCK.WATER || current === BLOCK.BEDROCK) {
    return
  }

  blocks[index] = BLOCK.AIR
}

type CarveContext = {
  readonly blocks: Uint16Array
  readonly margin: number
  readonly caveNoise: NoiseFn3D
  readonly coord: ChunkCoord
  readonly surfaceYs: Int16Array
}

/** Highest non-air, non-water block in each column. */
const computeSurfaceYs = (blocks: Uint16Array): Int16Array => {
  const surfaces = new Int16Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ).fill(NO_SURFACE_Y)
  const scanTop = CHUNK_HEIGHT - TOP_Y_INDEX_OFFSET

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      for (let y = scanTop; y > CAVE_FLOOR_Y; y -= AXIS_STEP) {
        const block = readBlock(blocks, blockIndex(lx, y, lz))
        if (block !== BLOCK.AIR && block !== BLOCK.WATER) {
          surfaces[lz * CHUNK_SIZE_XZ + lx] = y
          break
        }
      }
    }
  }

  return surfaces
}

/** Whether `y` is within the exposed solid shell above a dry cave. */
const isWithinSurfaceShell = (y: number, surfaceY: number): boolean =>
  surfaceY !== NO_SURFACE_Y && y > surfaceY - CAVE_SURFACE_MARGIN_BLOCKS

/**
 * Carve the 3D noise pocket in one column, respecting water and surface shells.
 *
 * ────────────────────────────────────────────────────────────────
 * THE GUARD. Leave a solid shell under any water body, or the bed
 * is carved away and the player gets a floating water sheet over an
 * unlit void. Do not replace this with a biome test — a lake in a
 * PLAINS basin is submerged and is not an OCEAN.
 * ────────────────────────────────────────────────────────────────
 */
const carveColumn = (context: CarveContext, waterFloorY: number, lx: number, lz: number): void => {
  const { blocks, margin, caveNoise, coord, surfaceYs } = context
  const surfaceY = readRequired(surfaceYs, lz * CHUNK_SIZE_XZ + lx)
  const protectsSurface = waterFloorY === NO_WATER_FLOOR
  const sampleX = worldX(coord, lx) * CAVE_NOISE_XZ_FREQUENCY
  const sampleZ = worldZ(coord, lz) * CAVE_NOISE_XZ_FREQUENCY

  for (let y = CAVE_FLOOR_Y; y <= CAVE_CEILING_Y; y += AXIS_STEP) {
    if (
      !(
        (protectsSurface && isWithinSurfaceShell(y, surfaceY)) ||
        isWithinWaterFloorShell(y, waterFloorY, margin)
      )
    ) {
      const index = blockIndex(lx, y, lz)
      const current = readBlock(blocks, index)
      if (current === BLOCK.AIR || current === BLOCK.WATER || current === BLOCK.BEDROCK) {
        continue
      }

      const density = caveNoise(sampleX, y * CAVE_NOISE_Y_FREQUENCY, sampleZ)
      if (density > CAVE_THRESHOLD) {
        carveVoxelIfClearable(blocks, index)
      }
    }
  }
}

/**
 * Carve caves into `blocks`, in place.
 *
 * Mutates rather than returning a new buffer. That is a deliberate exception to
 * this project's immutability preference: a chunk buffer is 64 KB, the pipeline
 * runs several passes over it per chunk, and copying at each pass is the kind
 * of cost that only shows up as stutter once a world is big. The mutation is
 * confined to a buffer this function's caller has just allocated and not yet
 * shared, so it is unobservable from outside `generateChunk`.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const waterFloorMarginFromOptions = (options: unknown): Result.Result<ValidatedWaterFloorMargin, InvalidWaterFloorMargin> => {
  if (!isRecord(options)) {
    return Result.fail(new InvalidWaterFloorMargin({ field: 'waterFloorMargin' }))
  }
  const descriptor = Option.fromNullishOr(Object.getOwnPropertyDescriptor(options, 'waterFloorMargin'))
  if (Option.isNone(descriptor)) {
    return Result.succeed(waterFloorMarginFromNumber(WATER_FLOOR_MARGIN))
  }
  if (!('value' in descriptor.value)) {
    return Result.fail(new InvalidWaterFloorMargin({ field: 'waterFloorMargin' }))
  }
  return validateWaterFloorMargin(descriptor.value.value)
}

const carveCavesWithMargin = (
  blocks: Uint16Array,
  seed: NoiseSeed,
  coord: ChunkCoord,
  margin: ValidatedWaterFloorMargin,
): void => {
  const waterFloors = computeWaterFloorYs(blocks, margin)
  const surfaceYs = computeSurfaceYs(blocks)
  const caveNoise = createNoiseField(channelSeed(seed, 'caves')).noise3d
  const context: CarveContext = { blocks, caveNoise, coord, margin, surfaceYs }

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      const waterFloorY = readRequired(waterFloors, lz * CHUNK_SIZE_XZ + lx)
      carveColumn(context, waterFloorY, lx, lz)
    }
  }
}

/** Carve caves into `blocks` after validating the public water-floor margin. */
export const carveCaves = (
  blocks: Uint16Array,
  seed: NoiseSeed,
  coord: ChunkCoord,
  options: CarveOptions = {},
): Result.Result<void, InvalidWaterFloorMargin> => {
  const margin = waterFloorMarginFromOptions(options)
  return Result.map(margin, (validatedMargin) => {
    carveCavesWithMargin(blocks, seed, coord, validatedMargin)
  })
}

/** Carve using a margin validated at the caller's public boundary. */
export const carveCavesWithValidatedMargin = (
  blocks: Uint16Array,
  seed: NoiseSeed,
  coord: ChunkCoord,
  margin: ValidatedWaterFloorMargin = waterFloorMarginFromNumber(WATER_FLOOR_MARGIN),
): void => carveCavesWithMargin(blocks, seed, coord, margin)

/** Recreates the hollow-lake regression without exposing a zero-margin API at the package root. */
export const carveCavesWithoutWaterFloorMarginForTesting = (
  blocks: Uint16Array,
  seed: NoiseSeed,
  coord: ChunkCoord,
): void => carveCavesWithMargin(blocks, seed, coord, waterFloorMarginFromNumber(TEST_WATER_FLOOR_MARGIN))
