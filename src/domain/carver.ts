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
 * `waterFloorMargin: 0` disables the guard, which is not a feature — it is a
 * test affordance. `test/carver.test.ts` generates the same chunk with the
 * guard on and off and asserts that the unguarded run really does hollow out a
 * lake bed. A regression test that cannot demonstrate the regression is only
 * asserting that today's code does what today's code does.
 */
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, WATER_FLOOR_MARGIN, blockIndex } from './constants.js'
import { channelSeed, valueNoise2D } from '@nerima-games/mc-noise'
import { worldX, worldZ } from './generator-coordinates.js'
import { BLOCK } from './biome.js'
import type { ChunkCoord } from '@nerima-games/mc-kernel'
import { readBlock } from './chunk.js'

/** Vertical band caves may occupy. Above bedrock, below the surface layer. */
export const CAVE_FLOOR_Y = 6
export const CAVE_CEILING_Y = 58

/** Above this noise value a column is carved. Higher = fewer caves. */
export const CAVE_THRESHOLD = 0.62

/** Sentinel meaning "this column holds no water" — see `computeWaterFloorYs`. */
const NO_WATER_FLOOR = -1

/** Single-block iteration step for the per-voxel scans below. */
const AXIS_STEP = 1

/** Converts a block count (`CHUNK_HEIGHT`) into the highest valid Y index. */
const TOP_Y_INDEX_OFFSET = 1

/**
 * Extra vertical headroom scanned above the margin-padded ceiling, so a water
 * body whose bed sits just above that padding is still detected.
 */
const WATER_FLOOR_SCAN_HEADROOM = 16

/** Cave noise field wavelength, in blocks: one full density cycle every this many blocks. */
const CAVE_NOISE_WAVELENGTH_BLOCKS = 24

/** A single noise cycle, used to turn the wavelength above into the frequency `valueNoise2D` expects. */
const NOISE_FREQUENCY_NUMERATOR = 1

/** Scales how much a cave's half-height grows per unit the density exceeds `CAVE_THRESHOLD` by. */
const CAVE_HEIGHT_DENSITY_SCALE = 40

export type CarveOptions = {
  /**
   * Solid blocks to preserve beneath the lowest water block in a column.
   * Defaults to `WATER_FLOOR_MARGIN` (3, matching the reference). Zero disables
   * the guard and reproduces the hollow-lake bug — for tests only.
   */
  readonly waterFloorMargin?: number
}

/**
 * Lowest water block in each column, or `-1` where the column holds no water.
 *
 * The scan deliberately reaches above `CAVE_CEILING_Y` by the margin, so a
 * water body whose bed sits just above the carving band is still protected. The
 * reference does the same and says why — `cave-carver.ts:20`:
 * `const scanTop = CAVE_CEILING + CAVE_WATER_FLOOR_MARGIN`.
 */
export const computeWaterFloorYs = (blocks: Uint8Array, margin: number): Int16Array => {
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
const carveVoxelIfClearable = (blocks: Uint8Array, index: number): void => {
  const current = readBlock(blocks, index)

  if (current === BLOCK.AIR || current === BLOCK.WATER || current === BLOCK.BEDROCK) {
    return
  }

  blocks[index] = BLOCK.AIR
}

type CarveContext = {
  readonly blocks: Uint8Array
  readonly margin: number
  readonly caveSeed: number
  readonly coord: ChunkCoord
}

type CaveBand = {
  readonly from: number
  readonly to: number
}

/** The vertical [from, to] band a cave occupies at this density. Taller where the field is stronger. */
const caveBandForDensity = (density: number): CaveBand => {
  const halfHeight = Math.floor((density - CAVE_THRESHOLD) * CAVE_HEIGHT_DENSITY_SCALE)
  const centre = Math.floor(CAVE_FLOOR_Y + (CAVE_CEILING_Y - CAVE_FLOOR_Y) * density)

  return {
    from: Math.max(CAVE_FLOOR_Y, centre - halfHeight),
    to: Math.min(CAVE_CEILING_Y, centre + halfHeight),
  }
}

/**
 * Carve one column, from its noise-derived cave band down to the
 * water-floor-shell guard on each voxel.
 *
 * ────────────────────────────────────────────────────────────────
 * THE GUARD. Leave a solid shell under any water body, or the bed
 * is carved away and the player gets a floating water sheet over an
 * unlit void. Do not replace this with a biome test — a lake in a
 * PLAINS basin is submerged and is not an OCEAN.
 * ────────────────────────────────────────────────────────────────
 */
const carveColumn = (context: CarveContext, waterFloorY: number, lx: number, lz: number): void => {
  const { blocks, margin, caveSeed, coord } = context
  const density = valueNoise2D(
    caveSeed,
    worldX(coord, lx),
    worldZ(coord, lz),
    NOISE_FREQUENCY_NUMERATOR / CAVE_NOISE_WAVELENGTH_BLOCKS,
  )

  if (density <= CAVE_THRESHOLD) {
    return
  }

  const { from, to } = caveBandForDensity(density)

  for (let y = from; y <= to; y += AXIS_STEP) {
    if (!isWithinWaterFloorShell(y, waterFloorY, margin)) {
      carveVoxelIfClearable(blocks, blockIndex(lx, y, lz))
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
export const carveCaves = (
  blocks: Uint8Array,
  seed: number,
  coord: ChunkCoord,
  options: CarveOptions = {},
): void => {
  const margin = options.waterFloorMargin ?? WATER_FLOOR_MARGIN
  const waterFloors = computeWaterFloorYs(blocks, margin)
  const caveSeed = channelSeed(seed, 'caves')
  const context: CarveContext = { blocks, caveSeed, coord, margin }

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      // Asserted, not defaulted with `?? NO_WATER_FLOOR`. `waterFloors` has length `CHUNK_SIZE_XZ * CHUNK_SIZE_XZ` (`computeWaterFloorYs` above), and for lx, lz drawn from `[0, CHUNK_SIZE_XZ)` the index `lz * CHUNK_SIZE_XZ + lx` reaches exactly `CHUNK_SIZE_XZ * CHUNK_SIZE_XZ - 1` at its maximum — always a valid, defined element. A `?? fallback` here would be an untested, unreachable branch rather than real defensive code. `noUncheckedIndexedAccess` still types the read as possibly `undefined`, hence the assertion.
      const waterFloorY = waterFloors[lz * CHUNK_SIZE_XZ + lx]!
      carveColumn(context, waterFloorY, lx, lz)
    }
  }
}
