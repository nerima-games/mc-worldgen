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
 * a continuous surface the player can walk on. One tree per grid cell, jittered
 * inside the cell, bounds the minimum spacing by construction.
 *
 * The conversion is `density × TREE_GRID_AREA`: a per-column probability
 * becomes a per-cell probability by multiplying by the cell's area, so the
 * expected number of trees per unit area is preserved and the density figure
 * keeps meaning what a designer expects.
 */
import { BIOME_TREE_DENSITY, type BiomeType } from './biome'
import type { TerrainLevels } from './constants'

/** Cell edge in blocks. `TREE_GRID_SIZE = 4`, `tree-placer.config.ts:35-41`. */
export const TREE_GRID_SIZE = 4

/** `TREE_GRID_AREA = 16`. Kept as its own constant so the two cannot drift. */
export const TREE_GRID_AREA = TREE_GRID_SIZE * TREE_GRID_SIZE

/** Sin-hash constants, `tree-placer.config.ts:26-28`. */
export const TREE_RNG_X_SCALE = 127.1
export const TREE_RNG_Z_SCALE = 311.7
export const TREE_RNG_AMPLITUDE = 43758.5453

/** Jitter and density-roll scales, `tree-placer.config.ts:35-41`. */
export const TREE_CELL_JITTER_X_SCALE = 3.97
export const TREE_CELL_JITTER_Z_SCALE = 5.23
export const TREE_DENSITY_ROLL_RNG_SCALE = 2.61

const fract = (value: number): number => value - Math.floor(value)

export type TreeCandidate = {
  readonly worldX: number
  readonly worldZ: number
  readonly cellRng: number
}

/**
 * The one candidate column in a grid cell, and the cell's random value.
 *
 * Direct port of `treeCellCandidate`, `tree-placer.ts:169-179`. Note that the
 * jitter and the density roll are derived from the *same* `cellRng` by
 * different multipliers — one hash evaluation per cell rather than three.
 */
export const treeCellCandidate = (cellX: number, cellZ: number): TreeCandidate => {
  const cellRng = Math.sin(cellX * TREE_RNG_X_SCALE + cellZ * TREE_RNG_Z_SCALE) * TREE_RNG_AMPLITUDE

  return {
    worldX: cellX * TREE_GRID_SIZE + Math.floor(fract(cellRng * TREE_CELL_JITTER_X_SCALE) * TREE_GRID_SIZE),
    worldZ: cellZ * TREE_GRID_SIZE + Math.floor(fract(cellRng * TREE_CELL_JITTER_Z_SCALE) * TREE_GRID_SIZE),
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
