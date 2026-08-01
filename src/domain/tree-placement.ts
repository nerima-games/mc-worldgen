/**
 * Tree placement: jittered grid, not per-column dice.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
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
 * The geometry caps density, and two biomes were over the cap
 * ---------------------------------------------------------------------------
 *
 * One tree per cell means the per-column density can never exceed
 * `1 / TREE_GRID_AREA`. More fundamentally, a minimum spacing of 6 caps ANY
 * non-fusing layout at 1/36 = 0.0278 trees per column, whatever the grid.
 * `BIOME_TREE_DENSITY` asked for 0.04 in FOREST and 0.03 in TAIGA. Both are
 * above 0.0278: those two biomes were requesting a canopy that cannot exist
 * without fusing, and the leaf slab was the generator honestly delivering it.
 * They came down to 0.012 and 0.009; the biomes that were already under the cap
 * did not move, and because the density conversion is per unit AREA, growing the
 * cell from 4×4 to 8×8 does not change their tree counts at all.
 */
import { BIOME_TREE_DENSITY, type BiomeType } from './biome'
import type { TerrainLevels } from './constants'

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
export const TREE_GRID_AREA = TREE_GRID_SIZE * TREE_GRID_SIZE

/** Sin-hash constants, `tree-placer.config.ts:26-28`. */
export const TREE_RNG_X_SCALE = 127.1
export const TREE_RNG_Z_SCALE = 311.7
export const TREE_RNG_AMPLITUDE = 43758.5453

/** Jitter and density-roll scales, `tree-placer.config.ts:35-41`. */
export const TREE_CELL_JITTER_X_SCALE = 3.97
export const TREE_CELL_JITTER_Z_SCALE = 5.23
export const TREE_DENSITY_ROLL_RNG_SCALE = 2.61

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
export const TREE_CELL_JITTER_ORIGIN = Math.floor((TREE_GRID_SIZE - TREE_CELL_JITTER_SPAN) / 2)

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
export const TREE_MIN_SPACING = TREE_GRID_SIZE - TREE_CELL_JITTER_SPAN + 1

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
    worldX: cellX * TREE_GRID_SIZE + jitterOffset(cellRng, TREE_CELL_JITTER_X_SCALE),
    worldZ: cellZ * TREE_GRID_SIZE + jitterOffset(cellRng, TREE_CELL_JITTER_Z_SCALE),
    cellRng,
  }
}

export const cellOf = (worldCoordinate: number): number => Math.floor(worldCoordinate / TREE_GRID_SIZE)

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
  readonly biome: BiomeType
  readonly terrainLevels: TerrainLevels
}): boolean => {
  const candidate = treeCellCandidate(cellOf(input.worldX), cellOf(input.worldZ))

  if (candidate.worldX !== input.worldX || candidate.worldZ !== input.worldZ) {
    return false
  }

  // Submerged columns never grow trees: the trunk would rise out of the water.
  if (input.surfaceY < input.terrainLevels.seaLevel) {
    return false
  }

  const density = BIOME_TREE_DENSITY[input.biome]

  return fract(candidate.cellRng * TREE_DENSITY_ROLL_RNG_SCALE) < density * TREE_GRID_AREA
}
