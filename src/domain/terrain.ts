/**
 * `generateChunk(seed, coords) → Chunk` — the public entry point (plan.md §3.7).
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * Pure and deterministic, and those are two different claims
 * ---------------------------------------------------------------------------
 *
 * Pure: no clock, no I/O, no global state. `pnpm check:deps` enforces the clock
 * half mechanically — `Date.now()`, `new Date()` and `performance.now()` are
 * banned repository-wide.
 *
 * Deterministic: the same `(seed, coord)` always produces byte-identical
 * output, on any machine, in any order, in a worker or on the main thread. This
 * is the property everything downstream rests on. A save file stores a seed and
 * not the terrain, so a drift in generation is retroactive world corruption for
 * every existing save.
 *
 * The sampling is position-absolute, never chunk-relative, which is what makes
 * chunk borders seamless: two neighbouring chunks asking about the same world
 * column get the same answer. The reference does the same
 * (`packages/world/domain/terrain/generator.ts:39-40`).
 *
 * ---------------------------------------------------------------------------
 * Pass order matters
 * ---------------------------------------------------------------------------
 *
 * Water is filled BEFORE caves are carved, because the carver's water-floor
 * guard works by probing for water blocks (see `domain/carver.ts`). Carving
 * first would leave nothing for it to find, and the guard would silently do
 * nothing — the failure mode being a subtly hollow lake rather than an error.
 *
 * The reference's ordering is more intricate still: caves are carved before
 * decoration (`generator.ts:102`) but ravines after trees and plants
 * (`generator.ts:155`), the stated reason being that ravine walls should "cut
 * cleanly through ores and surface cover". Both orderings are reproduced below.
 *
 * RAVINES ARE NOT BEHIND `decorate`, and the flag is the reason the pass sits
 * where it does rather than inside the block above it. `decorate: false` means
 * "no vegetation", not "no terrain" — `placeOres` is already outside it on the
 * same argument, and `test/chunk-golden.test.ts` pins what the flag means by
 * asserting that the two FOREST rows differ ONLY in vegetation and that every
 * difference replaced AIR. A carver inside that block would break both halves:
 * it removes rather than adds, and it would make the flag mean two things.
 *
 * The ordering survives anyway, because the ravine pass runs last either way.
 * It also produces the same cut with the flag on and off: the water guard reads
 * `blocks[surfaceY + 1]`, and a column that holds water there can never carry a
 * plant (`canPlaceGroundPlantAt` demands AIR) or a trunk (`shouldPlaceTree`
 * refuses `surfaceY < seaLevel`), so decoration cannot change the guard's
 * answer. `test/ravine.test.ts` R-6 pins that as a measurement rather than as
 * this paragraph.
 */
import {
  BEDROCK_Y,
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  DEFAULT_TERRAIN_LEVELS,
  type TerrainLevels,
  blockIndex,
} from './constants'
import {
  BIOME_SURFACES,
  BLOCK,
  type BiomeSurface,
  type BiomeType,
} from './biome'
import { type BlockId, type ChunkCoord, chunkCoord } from '@nerima-games/mc-kernel'
import { type CarveOptions, carveCaves } from './carver'
import {
  type Chunk,
  biomeAt,
  columnIndex,
  emptyBlocks,
  readBlock,
  worldX,
  worldZ,
} from './chunk'
import {
  type ClimateSample,
  classifyBiomeFromClimate,
  peaksAndValleysFromWeirdness,
} from './biome-classifier'
import { RIVER_NOISE_SCALE, RIVER_WORLD_OFFSET } from './biome-classifier.config'
import { TREE_CROWN_RADIUS, shouldPlaceTree } from './tree-placement'
import {
  canPlaceGroundPlantAt,
  groundPlantAt,
  plantGroundCover,
  shouldPlaceGroundPlant,
} from './vegetation'
import { channelSeed, fbm2D, valueNoise2D } from './seeded-random'
import { carveRavines } from './ravine'
import { placeOres } from './ore'
import { writeStrongholdBlocksForChunk } from './stronghold'
import { writeVillageBlocksForChunk } from './village'

/** Lowest and highest surface the base terrain shaper will produce. */
export const MIN_SURFACE_Y = 38
export const MAX_SURFACE_Y = 92

/**
 * Contrast applied to raw continentalness before it becomes a height.
 *
 * ---------------------------------------------------------------------------
 * MEASUREMENT — how the numbers below were taken
 * ---------------------------------------------------------------------------
 *
 * Method: the SURVEY scan of `pnpm preview --stats` — a strided sample, every
 * 16th block over 8192 × 8192 blocks centred on the origin, so 262,144 columns
 * spanning ~45 continentalness features at this field's 1/180 frequency.
 * Repeated for seeds 20260726, 1, 4242, 999983 and 77777; the figures below are
 * seed 20260726 and every other seed agrees to within half a point.
 *
 * The sample size is the whole point of this comment. A window has to be many
 * multiples of 1/frequency across before the tails of the distribution appear
 * in it at all — see the previous value's obituary at the bottom.
 *
 *     raw continentalness      [0.053, 0.946]   p5 0.266  p50 0.496  p95 0.733
 *
 * ---------------------------------------------------------------------------
 * THE CHOICE — 1.15
 * ---------------------------------------------------------------------------
 *
 * The field already spans almost the whole unit interval, so it needs almost no
 * stretching. What it does need is the last sliver: at contrast 1.0 the extremes
 * map to heights 40 and 89, and `MIN_SURFACE_Y` / `MAX_SURFACE_Y` are then
 * bounds no column ever reaches — declared limits that are fiction. 1.15 is the
 * smallest value at which both bounds are attained on this sample, and it costs
 * one column in ten thousand:
 *
 *     contrast   flat-clamped   below sea level   observed height range
 *     1.00           0.00%           41.7%              [40, 89]
 *     1.15           0.01%           42.9%              [38, 92]   <- chosen
 *     1.50           1.05%           44.8%              [38, 92]
 *     2.00           8.06%           46.4%              [38, 92]
 *     2.60          19.96%           47.5%              [38, 92]
 *
 * Contrast barely moves the ocean fraction (42% to 47% across that whole range)
 * because sea level sits near the middle of the height range; what it moves is
 * how much of the world is a flat clamped plane. So the design call is cheap:
 * take the ocean fraction the field gives you — 42.9% here, which is ample sea
 * for the carver's water-floor guard to be exercised by (docs/design-notes.md
 * DN-2) — and do not pay 20% of the world's surface for the other five points.
 *
 * The height histogram at 1.15 is a single-peaked hump centred on 64 with thin
 * tails. At 2.6 it was flat between the bounds with a spike at each end: 11.8%
 * of columns in the lowest 4-block bucket and 9.2% in the highest. That spike
 * IS the table-top mesa; a histogram is what it looks like from above.
 *
 * ---------------------------------------------------------------------------
 * WHY IT WAS 2.6 — the mistake, kept because it is instructive
 * ---------------------------------------------------------------------------
 *
 * The previous comment justified 2.6 with two measured numbers, both wrong:
 * that the raw field spans "about [0.40, 0.72]" and that without the stretch
 * "3% of columns fall below sea level". It named its sample: 800 × 800 blocks.
 * At 1/180 that is four terrain features across. Four features are enough to
 * see where the middle of the distribution is (0.496 — that part was right) and
 * nowhere near enough to see its tails. The true unstretched ocean fraction is
 * 41.7%, not 3%.
 *
 * Multiplying a distribution that really does reach 0.05 and 0.95 by 2.6
 * saturates both ends, which is how a fifth of the world became flat. Note the
 * shape of the error: the narrow sample did not produce a wrong-looking answer,
 * it produced a plausible one, and the constant chosen to fix the imaginary
 * problem then created a real one. `pnpm preview --stats` defaults to an 8192
 * block survey for this reason, and docs/testing.md §4-b F-5 records the same
 * trap being walked into a second time, with biomes.
 *
 * Stretching about the midpoint is still the right shape of knob, and is what
 * the reference does in its climate path (`stretchClimate`,
 * `packages/world/domain/biome-classifier.ts:91`, applied at `:104-105`).
 * `test/terrain-distribution.test.ts` pins the clamped fraction so that the
 * next person to reach for this constant has to move a number that was measured
 * rather than a number that was recalled.
 */
export const CONTINENTALNESS_CONTRAST = 1.15

const UNIT_INTERVAL_MIN = 0
const UNIT_INTERVAL_MAX = 1
const UNIT_INTERVAL_MIDPOINT = 0.5

const stretch = (value: number): number =>
  Math.min(
    UNIT_INTERVAL_MAX,
    Math.max(UNIT_INTERVAL_MIN, (value - UNIT_INTERVAL_MIDPOINT) * CONTINENTALNESS_CONTRAST + UNIT_INTERVAL_MIDPOINT),
  )

/** Depth of the biome-specific filler beneath the top block. */
const FILLER_DEPTH = 4

/** Single-block iteration step for the per-voxel/per-column loops below. */
const AXIS_STEP = 1

/** Shared "one" numerator for every `frequency: 1 / wavelength` noise call below. */
const NOISE_FREQUENCY_UNIT = 1
/** `continentalnessAt`'s noise wavelength, in blocks. */
const CONTINENTALNESS_WAVELENGTH_BLOCKS = 180
/** `climateAtWithContinentalness`'s temperature noise wavelength, in blocks. */
const TEMPERATURE_WAVELENGTH_BLOCKS = 320
/** `climateAtWithContinentalness`'s humidity noise wavelength, in blocks. */
const HUMIDITY_WAVELENGTH_BLOCKS = 280
/** `climateAtWithContinentalness`'s erosion noise wavelength, in blocks. */
const EROSION_WAVELENGTH_BLOCKS = 220
/** `climateAtWithContinentalness`'s weirdness noise wavelength, in blocks. */
const WEIRDNESS_WAVELENGTH_BLOCKS = 160
/** The river field's coordinates are pre-scaled by `RIVER_NOISE_SCALE`, so this call samples at unit frequency. */
const RIVER_NOISE_UNIT_FREQUENCY = 1

/** Scale factor of the `[0, 1] -> [-1, 1]` remap `toBipolar` applies. */
const BIPOLAR_SCALE = 2
/** Offset of the `[0, 1] -> [-1, 1]` remap `toBipolar` applies. */
const BIPOLAR_OFFSET = 1

/** Remaps a `[0, 1]` sample to `[-1, 1]` — `value * 2 - 1`. */
const toBipolar = (unitValue: number): number => unitValue * BIPOLAR_SCALE - BIPOLAR_OFFSET

export type GenerateOptions = {
  readonly terrainLevels?: TerrainLevels
  readonly carve?: CarveOptions
  readonly decorate?: boolean
}

/**
 * Surface height for a world column.
 *
 * Exported because it is the cheapest possible query about the world and the
 * chunk manager needs it for spawn selection without generating a whole chunk.
 * It must agree exactly with what `generateChunk` produces — `test/terrain.test.ts`
 * pins that.
 */
const continentalnessAt = (seed: number, wx: number, wz: number): number =>
  fbm2D(channelSeed(seed, 'continentalness'), wx, wz, {
    frequency: NOISE_FREQUENCY_UNIT / CONTINENTALNESS_WAVELENGTH_BLOCKS,
    octaves: 4,
    persistence: 0.5,
  })

const surfaceHeightFromContinentalness = (continentalness: number): number =>
  Math.floor(MIN_SURFACE_Y + (MAX_SURFACE_Y - MIN_SURFACE_Y) * stretch(continentalness))

export const surfaceHeightAt = (seed: number, wx: number, wz: number): number =>
  surfaceHeightFromContinentalness(continentalnessAt(seed, wx, wz))

const climateAtWithContinentalness = (
  seed: number,
  wx: number,
  wz: number,
  continentalness: number = toBipolar(continentalnessAt(seed, wx, wz)),
): ClimateSample => {
  const temperature = fbm2D(channelSeed(seed, 'temperature'), wx, wz, {
    frequency: NOISE_FREQUENCY_UNIT / TEMPERATURE_WAVELENGTH_BLOCKS,
    octaves: 2,
    persistence: 0.5,
  })
  const humidity = fbm2D(channelSeed(seed, 'humidity'), wx, wz, {
    frequency: NOISE_FREQUENCY_UNIT / HUMIDITY_WAVELENGTH_BLOCKS,
    octaves: 2,
    persistence: 0.5,
  })
  const erosion = toBipolar(valueNoise2D(channelSeed(seed, 'erosion'), wx, wz, NOISE_FREQUENCY_UNIT / EROSION_WAVELENGTH_BLOCKS))
  const weirdness = toBipolar(
    valueNoise2D(channelSeed(seed, 'weirdness'), wx, wz, NOISE_FREQUENCY_UNIT / WEIRDNESS_WAVELENGTH_BLOCKS),
  )
  const riverNoise = valueNoise2D(
    channelSeed(seed, 'river'),
    wx * RIVER_NOISE_SCALE + RIVER_WORLD_OFFSET,
    wz * RIVER_NOISE_SCALE + RIVER_WORLD_OFFSET,
    RIVER_NOISE_UNIT_FREQUENCY,
  )

  return {
    continentalness,
    erosion,
    humidity,
    pv: peaksAndValleysFromWeirdness(weirdness),
    riverNoise,
    temperature,
  }
}

export const climateAt = (seed: number, wx: number, wz: number): ClimateSample =>
  climateAtWithContinentalness(seed, wx, wz)

/** How far below sea level a column must sit before the OCEAN override applies. */
const OCEAN_BELOW_SEA_LEVEL_MARGIN = 2
/** How far above sea level a column may sit and still take the BEACH override. */
const BEACH_ABOVE_SEA_LEVEL_MARGIN = 1

type BiomeQuery = {
  readonly seed: number
  readonly wx: number
  readonly wz: number
  readonly surfaceY: number
  readonly levels: TerrainLevels
  readonly continentalness: number
}

/**
 * Biome for a column, after the submerged and shoreline overrides.
 *
 * The overrides run after climate classification, not instead of it: a desert
 * that happens to dip below sea level is an ocean there, whatever its climate
 * says. The reference applies its OCEAN override the same way, downstream of
 * `classifyBiome` (`biome-classifier.ts:113`).
 */
const biomeForWithContinentalness = (query: BiomeQuery): BiomeType => {
  const { seed, wx, wz, surfaceY, levels, continentalness } = query

  if (surfaceY < levels.seaLevel - OCEAN_BELOW_SEA_LEVEL_MARGIN) {
    return 'OCEAN'
  }
  if (surfaceY <= levels.seaLevel + BEACH_ABOVE_SEA_LEVEL_MARGIN) {
    return 'BEACH'
  }
  return classifyBiomeFromClimate(climateAtWithContinentalness(seed, wx, wz, toBipolar(continentalness)))
}

/**
 * Locked public signature (`docs/public-api.md` §"biomeFor") — five positional
 * parameters, called throughout `test/**`, `apps/preview-terrain` and
 * `scripts/**`. Bundling it into an options object would be a breaking change
 * to that contract, so its own `max-params` warning is not fixable from this
 * file alone; see this repository's lint follow-ups.
 */
export const biomeFor = (
  seed: number,
  wx: number,
  wz: number,
  surfaceY: number,
  levels: TerrainLevels,
): BiomeType =>
  biomeForWithContinentalness({ continentalness: continentalnessAt(seed, wx, wz), levels, seed, surfaceY, wx, wz })

type ColumnFill = {
  readonly lx: number
  readonly lz: number
  readonly surfaceY: number
  readonly biome: BiomeType
  readonly levels: TerrainLevels
}

/** One block above a Y, used both for "stone starts here" and "water starts here". */
const ONE_BLOCK_ABOVE = 1

/** A column's top block: the underwater variant when submerged, the dry one otherwise. */
const surfaceTopBlockId = (surface: BiomeSurface, submerged: boolean): BlockId => {
  if (submerged) {
    return surface.underwaterTop
  }
  return surface.top
}

const fillStoneCore = (blocks: Uint8Array, lx: number, lz: number, surfaceY: number): void => {
  for (let y = BEDROCK_Y + ONE_BLOCK_ABOVE; y < surfaceY - FILLER_DEPTH; y += AXIS_STEP) {
    blocks[blockIndex(lx, y, lz)] = BLOCK.STONE
  }
}

const fillColumn = (blocks: Uint8Array, column: ColumnFill): void => {
  const { lx, lz, surfaceY, biome, levels } = column
  const surface = BIOME_SURFACES[biome]
  const submerged = surfaceY < levels.seaLevel

  blocks[blockIndex(lx, BEDROCK_Y, lz)] = BLOCK.BEDROCK
  fillStoneCore(blocks, lx, lz, surfaceY)

  for (let y = Math.max(BEDROCK_Y + ONE_BLOCK_ABOVE, surfaceY - FILLER_DEPTH); y < surfaceY; y += AXIS_STEP) {
    blocks[blockIndex(lx, y, lz)] = surface.filler
  }
  blocks[blockIndex(lx, surfaceY, lz)] = surfaceTopBlockId(surface, submerged)

  // Water fills from just above the surface up to sea level. This happens
  // BEFORE carving, because the carver's guard probes for these blocks.
  for (let y = surfaceY + ONE_BLOCK_ABOVE; y <= levels.seaLevel && y < CHUNK_HEIGHT; y += AXIS_STEP) {
    blocks[blockIndex(lx, y, lz)] = BLOCK.WATER
  }
}

/** Trunk height for a planted tree, in blocks above the surface. */
const TREE_TRUNK_HEIGHT = 5

const plantTrunk = (blocks: Uint8Array, lx: number, lz: number, surfaceY: number): void => {
  for (let offset = ONE_BLOCK_ABOVE; offset <= TREE_TRUNK_HEIGHT; offset += AXIS_STEP) {
    const y = surfaceY + offset
    if (y < CHUNK_HEIGHT) {
      blocks[blockIndex(lx, y, lz)] = BLOCK.LOG
    }
  }
}

/**
 * The radius is `TREE_CROWN_RADIUS` and not a literal because it is one half
 * of the no-fusion inequality `TREE_MIN_SPACING >= 2 * TREE_CROWN_RADIUS + 2`
 * that the placement grid is sized to satisfy. Widening the crown here without
 * widening the grid is exactly how the leaf slab comes back.
 */
const isTreeCanopyCorner = (dx: number, dz: number): boolean =>
  Math.abs(dx) === TREE_CROWN_RADIUS && Math.abs(dz) === TREE_CROWN_RADIUS

/**
 * No chunk-bounds guard here, and that is a proven fact about the tree
 * placement grid rather than an oversight: `plantCanopyCell` is only ever
 * reached through `plantTree`, itself only called from `plantTreesPass` when
 * `shouldPlaceTree` (`tree-placement.ts`) returns true. `shouldPlaceTree`'s
 * first gate requires the column to be `cellOf(worldX)`/`cellOf(worldZ)`'s
 * single jittered grid candidate, whose offset inside its cell is
 * `TREE_CELL_JITTER_ORIGIN + [0, TREE_CELL_JITTER_SPAN)`. With
 * `TREE_GRID_SIZE = 8`, `TREE_CELL_JITTER_ORIGIN = 2`,
 * `TREE_CELL_JITTER_SPAN = 3` and `CHUNK_SIZE_XZ = 16` (two grid cells per
 * chunk per axis), the only reachable local trunk coordinates are
 * `{2, 3, 4, 10, 11, 12}` on each axis — every one at least
 * `TREE_CROWN_RADIUS` (2) away from both chunk edges (0 and 15), so a canopy
 * cell can never fall outside `[0, CHUNK_SIZE_XZ)`. This is not a local
 * assumption: `test/tree-canopy.test.ts` ("leaves no clipped crowns...")
 * already pins the general form as `TREE_CELL_JITTER_ORIGIN >=
 * TREE_CROWN_RADIUS` and `TREE_CELL_JITTER_ORIGIN + TREE_CELL_JITTER_SPAN - 1
 * + TREE_CROWN_RADIUS < TREE_GRID_SIZE`, so a future constant change that
 * broke this fails loudly there before it could reach `plantCanopyCell`.
 * A dead bounds check here would only have hidden that failure behind a
 * silently dropped `blockIndex` write (`blockIndex` does not itself bounds
 * check, and an out-of-chunk index writes into `blocks` where the JS
 * `Uint8Array` semantics either no-op or, for a negative index, wrap
 * unpredictably) — worse than letting the grid's own test catch it.
 */
const plantCanopyCell = (blocks: Uint8Array, x: number, z: number, crownY: number): void => {
  const index = blockIndex(x, crownY, z)
  if (readBlock(blocks, index) === BLOCK.AIR) {
    blocks[index] = BLOCK.LEAVES
  }
}

// Canopy, clipped to the chunk. Crossing a chunk border correctly needs the neighbour's buffer, which is the chunk manager's job — see docs/porting.md.
const plantCanopy = (blocks: Uint8Array, lx: number, lz: number, crownY: number): void => {
  for (let dx = -TREE_CROWN_RADIUS; dx <= TREE_CROWN_RADIUS; dx += AXIS_STEP) {
    for (let dz = -TREE_CROWN_RADIUS; dz <= TREE_CROWN_RADIUS; dz += AXIS_STEP) {
      if (!isTreeCanopyCorner(dx, dz)) {
        plantCanopyCell(blocks, lx + dx, lz + dz, crownY)
      }
    }
  }
}

const plantTree = (blocks: Uint8Array, lx: number, lz: number, surfaceY: number): void => {
  plantTrunk(blocks, lx, lz, surfaceY)
  plantCanopy(blocks, lx, lz, surfaceY + TREE_TRUNK_HEIGHT)
}

/** `createChunkBuffers`'s placeholder biome, overwritten for every column by `generateColumns` before any decoration pass reads it. */
const FALLBACK_DECORATION_BIOME: BiomeType = 'PLAINS'

type ChunkBuffers = {
  readonly blocks: Uint8Array
  readonly biomes: Array<BiomeType>
  readonly surfaces: Int16Array
}

const createChunkBuffers = (): ChunkBuffers => ({
  biomes: Array.from<BiomeType>({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }).fill(FALLBACK_DECORATION_BIOME),
  blocks: emptyBlocks(),
  surfaces: new Int16Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ),
})

type ChunkGenerationContext = ChunkBuffers & {
  readonly seed: number
  readonly coord: ChunkCoord
  readonly levels: TerrainLevels
}

/**
 * Asserted rather than defaulted with `?? fallback`: `context.surfaces` and
 * `context.biomes` are only ever read from `plantTreesPass` /
 * `plantGroundCoverPass`, both only called (via `decorateChunk`) from
 * `generateChunk` — and only AFTER `generateColumns` has already written
 * every `(lx, lz)` in `[0, CHUNK_SIZE_XZ) x [0, CHUNK_SIZE_XZ)` (see
 * `generateChunk`'s call order below). `columnIndex(lx, lz) = lz *
 * CHUNK_SIZE_XZ + lx` never exceeds `CHUNK_SIZE_XZ * CHUNK_SIZE_XZ - 1` for
 * lx, lz in that range, which is exactly `surfaces.length - 1` /
 * `biomes.length - 1`. A `?? fallback` here would be an untested,
 * unreachable branch rather than real defensive code.
 * `noUncheckedIndexedAccess` still types both reads as possibly `undefined`,
 * hence the assertions.
 */
const columnSurfaceY = (context: ChunkGenerationContext, lx: number, lz: number): number =>
  context.surfaces[columnIndex(lx, lz)]!

const columnBiome = (context: ChunkGenerationContext, lx: number, lz: number): BiomeType =>
  context.biomes[columnIndex(lx, lz)]!

const generateColumns = (context: ChunkGenerationContext): void => {
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      const wx = worldX(context.coord, lx)
      const wz = worldZ(context.coord, lz)
      const continentalness = continentalnessAt(context.seed, wx, wz)
      const surfaceY = surfaceHeightFromContinentalness(continentalness)
      const biome = biomeForWithContinentalness({
        continentalness,
        levels: context.levels,
        seed: context.seed,
        surfaceY,
        wx,
        wz,
      })

      context.biomes[columnIndex(lx, lz)] = biome
      context.surfaces[columnIndex(lx, lz)] = surfaceY

      fillColumn(context.blocks, { biome, levels: context.levels, lx, lz, surfaceY })
    }
  }
}

const plantTreesPass = (context: ChunkGenerationContext): void => {
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      const surfaceY = columnSurfaceY(context, lx, lz)
      const biome = columnBiome(context, lx, lz)

      if (
        shouldPlaceTree({
          biome,
          surfaceY,
          terrainLevels: context.levels,
          worldX: worldX(context.coord, lx),
          worldZ: worldZ(context.coord, lz),
        })
      ) {
        plantTree(context.blocks, lx, lz, surfaceY)
      }
    }
  }
}

/**
 * Ground cover runs in a SECOND pass, after every trunk is standing. The
 * support rule refuses a column whose `surfaceY + 1` is not AIR, so a plant
 * can never displace a trunk — but only if every trunk is already there.
 * Fused into the tree pass, a plant placed at (lx, lz) before that column's
 * own tree was considered would make the tree's first log overwrite it, and
 * the flower would vanish depending on iteration order.
 */
const plantGroundCoverPass = (context: ChunkGenerationContext): void => {
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      const surfaceY = columnSurfaceY(context, lx, lz)
      const biome = columnBiome(context, lx, lz)
      const wx = worldX(context.coord, lx)
      const wz = worldZ(context.coord, lz)

      if (
        shouldPlaceGroundPlant({ biome, seed: context.seed, surfaceY, worldX: wx, worldZ: wz }) &&
        canPlaceGroundPlantAt(context.blocks, lx, surfaceY, lz)
      ) {
        plantGroundCover(context.blocks, { lx, lz, surfaceY }, groundPlantAt(context.seed, wx, wz, biome))
      }
    }
  }
}

const decorateChunk = (context: ChunkGenerationContext): void => {
  plantTreesPass(context)
  plantGroundCoverPass(context)
}

/** Structures run last so their shell, roads and interiors override carving and vegetation. */
const writeStructures = (blocks: Uint8Array, seed: number, coord: ChunkCoord, levels: TerrainLevels): void => {
  writeVillageBlocksForChunk(blocks, seed, coord, (wx, wz) => {
    const surfaceY = surfaceHeightAt(seed, wx, wz)
    return { biome: biomeFor(seed, wx, wz, surfaceY, levels), seaLevel: levels.seaLevel, surfaceY }
  })
  writeStrongholdBlocksForChunk(blocks, seed, coord)
}

/**
 * Generate a chunk. Total, pure, and a function of `(seed, coord)` alone.
 */
export const generateChunk = (seed: number, coord: ChunkCoord, options: GenerateOptions = {}): Chunk => {
  const context: ChunkGenerationContext = {
    ...createChunkBuffers(),
    coord,
    levels: options.terrainLevels ?? DEFAULT_TERRAIN_LEVELS,
    seed,
  }

  generateColumns(context)
  carveCaves(context.blocks, seed, coord, options.carve ?? {})

  // Ore goes in AFTER carving, so that a cave wall can expose a vein, and it is
  // NOT behind `decorate` — ore is stone, not decoration. See `domain/ore.ts`.
  placeOres(context.blocks, seed, coord)

  if (options.decorate !== false) {
    decorateChunk(context)
  }

  // Ravines LAST, after ore and after decoration, so their walls cut cleanly through both — the reference's ordering and its stated reason (`generator.ts:141-142`). See the module header for why this is outside the `decorate` block rather than at the end of it.
  carveRavines({ biomes: context.biomes, blocks: context.blocks, coord, seed, surfaces: context.surfaces })
  writeStructures(context.blocks, seed, coord, context.levels)

  return { biomes: context.biomes, blocks: context.blocks, coord }
}

/** Convenience for callers that have plain numbers rather than a `ChunkCoord`. */
export const generateChunkAt = (seed: number, x: number, z: number, options: GenerateOptions = {}): Chunk =>
  generateChunk(seed, chunkCoord(x, z), options)

/** Re-exported so callers need one import to read a generated chunk. */
export { biomeAt }
