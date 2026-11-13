/**
 * Tree placement: jittered grid, not per-column dice.
 *
 * This module implements the current tree placement policy.
 *
 * plan.md §3.7: 「木は格子ジッター配置(トリビアルな乱数散布は視覚的に偏る)」.
 * The reference implementation states the reason at
 * `packages/world/domain/terrain/tree-placer.ts:184-188` and repeats it in
 * `tree-placer.config.ts:30-34`:
 *
 *   `treeDensity` is the *effective per-column* probability (vanilla forest is
 *   about 0.04), but placement is a jittered grid rather than a per-column
 *   Bernoulli trial — "Independent per-column rolls at forest-like rates fused
 *   the radius-2 crowns into a walkable leaf slab".
 *
 * That is the whole point. Independent rolls do not merely look uneven; at
 * forest density they cluster hard enough that neighbouring canopies merge into
 * a continuous surface the player can walk on.
 *
 * Oak-compatible biomes use an explicit shape, density, and trunk-height
 * profile. Biomes whose vanilla species is not registered have no tree profile;
 * they do not silently receive oak as a substitute. A missing biome profile is
 * a typed failure.
 *
 * The conversion is `density × TREE_GRID_AREA`: a per-column probability
 * becomes a per-cell probability by multiplying by the cell's area, so the
 * expected number of trees per unit area is preserved and the density figure
 * keeps meaning what a designer expects.
 *
 * ---------------------------------------------------------------------------
 * A jittered grid bounds DENSITY. Bounding SPACING takes one more constant.
 * ---------------------------------------------------------------------------
 *
 * This header used to end "One tree per grid cell, jittered inside the cell,
 * bounds the minimum spacing by construction." That sentence was false, and it
 * was false in the way that matters: it named the exact property the grid was
 * introduced to provide, so nobody checked it.
 *
 * With jitter free to land anywhere in the cell, two candidates in ADJACENT
 * cells can be one block apart — the low corner of one cell and the high corner
 * of its neighbour are adjacent columns. Measured over a dense 384 × 384 block
 * scan of 815 trees at `TREE_GRID_SIZE = 4`: nearest-neighbour spacing min 1,
 * p50 3, and 75.6% of crowns overlapping a neighbour's. In generated block data
 * the largest 4-connected patch of LEAVES at one Y in one chunk was 78 blocks,
 * against 21 for a single crown — the walkable leaf slab, four crowns fused,
 * still there after the grid was introduced. (docs/testing.md §4-b F-2.)
 *
 * The fix is to confine the jitter to a WINDOW inside the cell, leaving a gutter
 * the candidate cannot enter. Adjacent cells are `TREE_GRID_SIZE` apart, and the
 * worst case is one candidate at the top of its window and its neighbour at the
 * bottom of the next, so
 *
 *     TREE_MIN_SPACING = TREE_GRID_SIZE - TREE_CELL_JITTER_SPAN + 1
 *
 * and that is a bound by construction, on the CANDIDATE LATTICE, before any
 * density or biome or submersion test runs. Every later gate only removes
 * candidates, so the bound survives all of them — which is what makes it
 * checkable without simulating the whole pipeline.
 *
 * How far apart is far enough? A crown is a square of radius
 * `TREE_CROWN_RADIUS` centred on the trunk column, so two crowns occupy adjacent
 * columns — and therefore fuse into one 4-connected patch of leaves — unless
 * their trunks are more than `2 × TREE_CROWN_RADIUS` apart. Strictly more: at
 * exactly `2 × radius + 1` the two crowns' edge columns touch. Hence
 *
 *     TREE_MIN_SPACING >= 2 * TREE_CROWN_RADIUS + 2
 *
 * which for radius 2 is 6, and `8 - 3 + 1 = 6` is why the grid is 8 with a
 * 3-wide jitter window. `test/tree-canopy.test.ts` asserts the inequality on the
 * constants AND measures the resulting leaf patches in real `generateChunk`
 * output across a stitched block of chunks, because the fusion happens in the
 * world and not in the placement function.
 *
 * ---------------------------------------------------------------------------
 * The geometry caps density, so oak profiles stay below its ceiling
 * ---------------------------------------------------------------------------
 *
 * One tree per cell means the per-column density can never exceed
 * `1 / TREE_GRID_AREA`. More fundamentally, a minimum spacing of 6 caps ANY
 * non-fusing layout at 1/36 = 0.0278 trees per column, whatever the grid.
 * The oak profiles use lower per-column targets than either bound. Biomes whose
 * vanilla tree species is not registered have no-tree profiles instead of an
 * oak substitute. Because density is converted by cell AREA, the grid size does
 * not change the target tree count per unit area.
 */
import { BIOME_TREE_DENSITY, type BiomeType, type KernelBiomeType } from './biome.js'
import { Data, Result } from 'effect'
import type { TerrainLevels } from './constants.js'

/**
 * Cell edge in blocks.
 *
 * The reference uses `TREE_GRID_SIZE = 4` (`tree-placer.config.ts:35-41`) with
 * jitter over the whole cell. 8 with a 3-wide jitter window is a deliberate
 * divergence: it is the smallest cell that yields `TREE_MIN_SPACING = 6` while
 * leaving the jitter more than one position to choose from. See the header.
 */
export const TREE_GRID_SIZE = 8

/** `TREE_GRID_SIZE ** 2`. Kept as its own constant so the two cannot drift. */
export const TREE_GRID_AREA: number = TREE_GRID_SIZE * TREE_GRID_SIZE

/** Sin-hash constants, `tree-placer.config.ts:26-28`. */
export const TREE_RNG_X_SCALE = 127.1
export const TREE_RNG_Z_SCALE = 311.7
export const TREE_RNG_AMPLITUDE = 43758.5453

/** Jitter and density-roll scales, `tree-placer.config.ts:35-41`. */
export const TREE_CELL_JITTER_X_SCALE = 3.97
export const TREE_CELL_JITTER_Z_SCALE = 5.23
export const TREE_DENSITY_ROLL_RNG_SCALE = 2.61
const TREE_HEIGHT_RNG_SCALE = 8.31
const TREE_HEIGHT_RANGE_INCLUSIVE_OFFSET = 1
const DENSE_OAK_TRUNK_HEIGHT_MIN = 5
const DENSE_OAK_TRUNK_HEIGHT_MAX = 7
const SPARSE_OAK_TRUNK_HEIGHT_MIN = 4
const SPARSE_OAK_TRUNK_HEIGHT_MAX = 5
const LOW_OAK_TRUNK_HEIGHT_MIN = 2
const LOW_OAK_TRUNK_HEIGHT_MAX = 3

/**
 * How many columns of its cell a candidate may land on, per axis.
 *
 * Anything less than `TREE_GRID_SIZE` leaves a gutter the candidate cannot
 * enter, and the gutter is the whole minimum-spacing guarantee. 1 would be a
 * perfect lattice with no jitter at all.
 */
export const TREE_CELL_JITTER_SPAN = 3

/**
 * Where the jitter window starts inside the cell. Derived, not chosen: the
 * window is centred, so that the lattice a saturated forest falls back to is the
 * cell centres rather than the cell corners.
 */
/** The window is centred in the leftover span, so its start is offset by half of it. */
const JITTER_WINDOW_CENTERING_DIVISOR = 2

export const TREE_CELL_JITTER_ORIGIN: number = Math.floor((TREE_GRID_SIZE - TREE_CELL_JITTER_SPAN) / JITTER_WINDOW_CENTERING_DIVISOR)

/**
 * Radius of the square canopy `plantTree` writes, in columns.
 *
 * It lives here rather than next to `plantTree` because it is half of the
 * spacing inequality above: the placement grid and the crown size are one
 * decision, and splitting them across two files is how they drift until the
 * crowns fuse again.
 */
export const TREE_CROWN_RADIUS = 2

/**
 * Guaranteed minimum Chebyshev distance between any two tree candidates.
 *
 * Derived from the grid, never asserted about it. `test/tree-canopy.test.ts`
 * checks both that this equals the measured minimum over a large field of cells
 * and that it satisfies `>= 2 * TREE_CROWN_RADIUS + 2`.
 */
/**
 * Worst case is one candidate at the top of its jitter window and its neighbour at the bottom of
 * the next cell's, one column further apart than the raw gap between windows.
 */
const MIN_SPACING_ADJACENT_WINDOW_OFFSET = 1

export const TREE_MIN_SPACING: number = TREE_GRID_SIZE - TREE_CELL_JITTER_SPAN + MIN_SPACING_ADJACENT_WINDOW_OFFSET

/** Oak is the only registered log/leaf pair in the pinned kernel registry. */
export const AVAILABLE_TREE_SPECIES = ['oak'] as const

/** These vanilla species have no registered log and leaf blocks in the pinned kernel registry. */
export const UNAVAILABLE_TREE_SPECIES = [
  'birch',
  'spruce',
  'jungle',
  'acacia',
  'dark_oak',
  'mangrove',
  'cherry',
  'bamboo',
  'crimson',
  'warped',
  'pale_oak',
  'poplar',
] as const

export const KERNEL_BIOME_TREE_DENSITY: Readonly<Record<KernelBiomeType, number>> = {
  badlands: 0,
  bamboo_jungle: 0,
  basalt_deltas: 0,
  beach: 0,
  birch_forest: 0,
  cherry_grove: 0,
  cold_ocean: 0,
  crimson_forest: 0,
  dappled_forest: 0.012,
  dark_forest: 0,
  deep_cold_ocean: 0,
  deep_dark: 0,
  deep_frozen_ocean: 0,
  deep_lukewarm_ocean: 0,
  deep_ocean: 0,
  desert: 0,
  dripstone_caves: 0,
  end_barrens: 0,
  end_highlands: 0,
  end_midlands: 0,
  eroded_badlands: 0,
  flower_forest: 0.012,
  forest: 0.012,
  frozen_ocean: 0,
  frozen_peaks: 0,
  frozen_river: 0,
  grove: 0,
  ice_spikes: 0,
  jagged_peaks: 0,
  jungle: 0,
  lukewarm_ocean: 0,
  lush_caves: 0,
  mangrove_swamp: 0,
  meadow: 0.006,
  mushroom_fields: 0,
  nether_wastes: 0,
  ocean: 0,
  old_growth_birch_forest: 0,
  old_growth_pine_taiga: 0,
  old_growth_spruce_taiga: 0,
  pale_garden: 0,
  plains: 0.006,
  river: 0,
  savanna: 0,
  savanna_plateau: 0,
  small_end_islands: 0,
  snowy_beach: 0,
  snowy_plains: 0,
  snowy_slopes: 0,
  snowy_taiga: 0,
  soul_sand_valley: 0,
  sparse_jungle: 0.004,
  stony_peaks: 0,
  stony_shore: 0,
  sulfur_caves: 0,
  sunflower_plains: 0.006,
  swamp: 0.006,
  taiga: 0,
  the_end: 0,
  the_void: 0,
  warm_ocean: 0,
  warped_forest: 0,
  windswept_forest: 0.006,
  windswept_gravelly_hills: 0.003,
  windswept_hills: 0.004,
  windswept_savanna: 0,
  wooded_badlands: 0.003,
}

type TreeBiomeShape = 'none' | 'dense' | 'sparse' | 'low'

export type TreeBiomeConfiguration = Readonly<{
  readonly species: 'oak' | null
  readonly shape: TreeBiomeShape
  readonly density: number
  readonly trunkHeightMin: number
  readonly trunkHeightMax: number
}>

const noTreeConfiguration: TreeBiomeConfiguration = {
  density: 0,
  shape: 'none',
  species: null,
  trunkHeightMax: 0,
  trunkHeightMin: 0,
}

const oakConfiguration = (
  shape: Exclude<TreeBiomeShape, 'none'>,
  density: number,
  trunkHeightMin: number,
  trunkHeightMax: number,
): TreeBiomeConfiguration => ({ density, shape, species: 'oak', trunkHeightMax, trunkHeightMin })

const denseOak = (density: number): TreeBiomeConfiguration =>
  oakConfiguration('dense', density, DENSE_OAK_TRUNK_HEIGHT_MIN, DENSE_OAK_TRUNK_HEIGHT_MAX)
const sparseOak = (density: number): TreeBiomeConfiguration =>
  oakConfiguration('sparse', density, SPARSE_OAK_TRUNK_HEIGHT_MIN, SPARSE_OAK_TRUNK_HEIGHT_MAX)
const lowOak = (density: number): TreeBiomeConfiguration =>
  oakConfiguration('low', density, LOW_OAK_TRUNK_HEIGHT_MIN, LOW_OAK_TRUNK_HEIGHT_MAX)

const LEGACY_TREE_CONFIGURATIONS: Readonly<Record<BiomeType, TreeBiomeConfiguration>> = {
  BEACH: noTreeConfiguration,
  DESERT: noTreeConfiguration,
  FLOWER_FOREST: denseOak(BIOME_TREE_DENSITY.FLOWER_FOREST),
  FOREST: denseOak(BIOME_TREE_DENSITY.FOREST),
  JUNGLE: noTreeConfiguration,
  MOUNTAINS: lowOak(BIOME_TREE_DENSITY.MOUNTAINS),
  OCEAN: noTreeConfiguration,
  PLAINS: sparseOak(BIOME_TREE_DENSITY.PLAINS),
  RIVER: noTreeConfiguration,
  SAVANNA: noTreeConfiguration,
  SNOW: noTreeConfiguration,
  SWAMP: sparseOak(BIOME_TREE_DENSITY.SWAMP),
  TAIGA: noTreeConfiguration,
}

const KERNEL_TREE_CONFIGURATIONS: Readonly<Record<KernelBiomeType, TreeBiomeConfiguration>> = {
  badlands: noTreeConfiguration,
  bamboo_jungle: noTreeConfiguration,
  basalt_deltas: noTreeConfiguration,
  beach: noTreeConfiguration,
  birch_forest: noTreeConfiguration,
  cherry_grove: noTreeConfiguration,
  cold_ocean: noTreeConfiguration,
  crimson_forest: noTreeConfiguration,
  dappled_forest: denseOak(KERNEL_BIOME_TREE_DENSITY.dappled_forest),
  dark_forest: noTreeConfiguration,
  deep_cold_ocean: noTreeConfiguration,
  deep_dark: noTreeConfiguration,
  deep_frozen_ocean: noTreeConfiguration,
  deep_lukewarm_ocean: noTreeConfiguration,
  deep_ocean: noTreeConfiguration,
  desert: noTreeConfiguration,
  dripstone_caves: noTreeConfiguration,
  end_barrens: noTreeConfiguration,
  end_highlands: noTreeConfiguration,
  end_midlands: noTreeConfiguration,
  eroded_badlands: noTreeConfiguration,
  flower_forest: denseOak(KERNEL_BIOME_TREE_DENSITY.flower_forest),
  forest: denseOak(KERNEL_BIOME_TREE_DENSITY.forest),
  frozen_ocean: noTreeConfiguration,
  frozen_peaks: noTreeConfiguration,
  frozen_river: noTreeConfiguration,
  grove: noTreeConfiguration,
  ice_spikes: noTreeConfiguration,
  jagged_peaks: noTreeConfiguration,
  jungle: noTreeConfiguration,
  lukewarm_ocean: noTreeConfiguration,
  lush_caves: noTreeConfiguration,
  mangrove_swamp: noTreeConfiguration,
  meadow: sparseOak(KERNEL_BIOME_TREE_DENSITY.meadow),
  mushroom_fields: noTreeConfiguration,
  nether_wastes: noTreeConfiguration,
  ocean: noTreeConfiguration,
  old_growth_birch_forest: noTreeConfiguration,
  old_growth_pine_taiga: noTreeConfiguration,
  old_growth_spruce_taiga: noTreeConfiguration,
  pale_garden: noTreeConfiguration,
  plains: sparseOak(KERNEL_BIOME_TREE_DENSITY.plains),
  river: noTreeConfiguration,
  savanna: noTreeConfiguration,
  savanna_plateau: noTreeConfiguration,
  small_end_islands: noTreeConfiguration,
  snowy_beach: noTreeConfiguration,
  snowy_plains: noTreeConfiguration,
  snowy_slopes: noTreeConfiguration,
  snowy_taiga: noTreeConfiguration,
  soul_sand_valley: noTreeConfiguration,
  sparse_jungle: sparseOak(KERNEL_BIOME_TREE_DENSITY.sparse_jungle),
  stony_peaks: noTreeConfiguration,
  stony_shore: noTreeConfiguration,
  sulfur_caves: noTreeConfiguration,
  sunflower_plains: sparseOak(KERNEL_BIOME_TREE_DENSITY.sunflower_plains),
  swamp: sparseOak(KERNEL_BIOME_TREE_DENSITY.swamp),
  taiga: noTreeConfiguration,
  the_end: noTreeConfiguration,
  the_void: noTreeConfiguration,
  warm_ocean: noTreeConfiguration,
  warped_forest: noTreeConfiguration,
  windswept_forest: sparseOak(KERNEL_BIOME_TREE_DENSITY.windswept_forest),
  windswept_gravelly_hills: lowOak(KERNEL_BIOME_TREE_DENSITY.windswept_gravelly_hills),
  windswept_hills: lowOak(KERNEL_BIOME_TREE_DENSITY.windswept_hills),
  windswept_savanna: noTreeConfiguration,
  wooded_badlands: lowOak(KERNEL_BIOME_TREE_DENSITY.wooded_badlands),
}

/** All accepted biome IDs have an explicit oak or no-tree configuration. */
const TREE_CONFIG_BY_KNOWN_BIOME: Readonly<Record<BiomeType | KernelBiomeType, TreeBiomeConfiguration>> = {
  ...LEGACY_TREE_CONFIGURATIONS,
  ...KERNEL_TREE_CONFIGURATIONS,
}

type UnsupportedTreeBiomeFields = { readonly field: 'biome' }

const taggedError = Data.TaggedError

export const UnsupportedTreeBiome: new (
  args: UnsupportedTreeBiomeFields,
) => Error & { readonly _tag: 'UnsupportedTreeBiome' } & Readonly<UnsupportedTreeBiomeFields> =
  taggedError('UnsupportedTreeBiome')<UnsupportedTreeBiomeFields>

export type UnsupportedTreeBiome = InstanceType<typeof UnsupportedTreeBiome>

const TREE_CONFIGURATION_RESULTS_BY_BIOME = new Map<string, Result.Result<TreeBiomeConfiguration, UnsupportedTreeBiome>>(
  Object.entries(TREE_CONFIG_BY_KNOWN_BIOME).map(([biome, configuration]) => [
    biome,
    Result.succeed(configuration),
  ]),
)

export const treeConfigurationForBiome = (
  biome: unknown,
): Result.Result<TreeBiomeConfiguration, UnsupportedTreeBiome> => {
  if (typeof biome !== 'string') {
    return Result.fail(new UnsupportedTreeBiome({ field: 'biome' }))
  }
  return TREE_CONFIGURATION_RESULTS_BY_BIOME.get(biome) ??
    Result.fail(new UnsupportedTreeBiome({ field: 'biome' }))
}

const fract = (value: number): number => value - Math.floor(value)

export type TreeCandidate = {
  readonly worldX: number
  readonly worldZ: number
  readonly cellRng: number
}

/**
 * The offset of the candidate inside its cell, on one axis.
 *
 * `TREE_CELL_JITTER_SPAN` rather than `TREE_GRID_SIZE` is the one-token
 * difference between bounding density and bounding spacing.
 */
const jitterOffset = (cellRng: number, scale: number): number =>
  TREE_CELL_JITTER_ORIGIN + Math.floor(fract(cellRng * scale) * TREE_CELL_JITTER_SPAN)

/**
 * The one candidate column in a grid cell, and the cell's random value.
 *
 * Port of `treeCellCandidate`, `tree-placer.ts:169-179`, with the jitter
 * confined to a window (see the header — the reference jitters over the whole
 * cell, which is why its crowns fuse). Note that the jitter and the density roll
 * are derived from the *same* `cellRng` by different multipliers — one hash
 * evaluation per cell rather than three.
 */
export const treeCellCandidate = (cellX: number, cellZ: number): TreeCandidate => {
  const cellRng = Math.sin(cellX * TREE_RNG_X_SCALE + cellZ * TREE_RNG_Z_SCALE) * TREE_RNG_AMPLITUDE

  return {
    cellRng,
    worldX: cellX * TREE_GRID_SIZE + jitterOffset(cellRng, TREE_CELL_JITTER_X_SCALE),
    worldZ: cellZ * TREE_GRID_SIZE + jitterOffset(cellRng, TREE_CELL_JITTER_Z_SCALE),
  }
}

export const cellOf = (worldCoordinate: number): number => Math.floor(worldCoordinate / TREE_GRID_SIZE)

export const treeTrunkHeightForConfiguration = (
  configuration: TreeBiomeConfiguration,
  cellRng: number,
): number => {
  const heightRange =
    configuration.trunkHeightMax - configuration.trunkHeightMin + TREE_HEIGHT_RANGE_INCLUSIVE_OFFSET
  return configuration.trunkHeightMin + Math.floor(fract(cellRng * TREE_HEIGHT_RNG_SCALE) * heightRange)
}

const shouldPlaceTreeWithConfiguration = (
  input: {
    readonly worldX: number
    readonly worldZ: number
    readonly surfaceY: number
    readonly terrainLevels: TerrainLevels
  },
  configuration: TreeBiomeConfiguration,
  candidate: TreeCandidate,
): boolean => {
  if (configuration.species === null) {
    return false
  }

  if (candidate.worldX !== input.worldX || candidate.worldZ !== input.worldZ) {
    return false
  }

  // Submerged columns never grow trees: the trunk would rise out of the water.
  if (input.surfaceY < input.terrainLevels.seaLevel) {
    return false
  }

  return fract(candidate.cellRng * TREE_DENSITY_ROLL_RNG_SCALE) < configuration.density * TREE_GRID_AREA
}

/**
 * Whether a tree grows at this world column.
 *
 * Three gates, in order (`tree-placer.ts:189-220`):
 *
 *  1. this column is the cell's jittered candidate (`:211-214`)
 *  2. the cell's density roll succeeds (`:215`) — one roll per cell, not per column
 *  3. the column is not submerged (`:207`)
 *
 * Gate 3 has its own history: `tree-placer.ts:200-206` carries a seven-line
 * comment about trees growing on the ocean. A surface below sea level is a lake
 * or sea bed, and a trunk placed there rises through the water.
 */
export const shouldPlaceTree = (input: {
  readonly worldX: number
  readonly worldZ: number
  readonly surfaceY: number
  readonly biome: string
  readonly terrainLevels: TerrainLevels
}): Result.Result<boolean, UnsupportedTreeBiome> => {
  const candidate = treeCellCandidate(cellOf(input.worldX), cellOf(input.worldZ))
  return Result.map(treeConfigurationForBiome(input.biome), (configuration) =>
    shouldPlaceTreeWithConfiguration(input, configuration, candidate),
  )
}

export const shouldPlaceTreeForKnownBiome = (input: {
  readonly worldX: number
  readonly worldZ: number
  readonly surfaceY: number
  readonly biome: BiomeType | KernelBiomeType
  readonly terrainLevels: TerrainLevels
}): boolean => {
  const candidate = treeCellCandidate(cellOf(input.worldX), cellOf(input.worldZ))
  return shouldPlaceTreeWithConfiguration(input, TREE_CONFIG_BY_KNOWN_BIOME[input.biome], candidate)
}

export const shouldPlaceTreeWithKnownConfiguration = (
  input: {
    readonly worldX: number
    readonly worldZ: number
    readonly surfaceY: number
    readonly terrainLevels: TerrainLevels
  },
  configuration: TreeBiomeConfiguration,
  candidate: TreeCandidate,
): boolean => shouldPlaceTreeWithConfiguration(input, configuration, candidate)
