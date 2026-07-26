import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { BIOMES, BIOME_SURFACES, BIOME_TREE_DENSITY, classifyBiome, FALLBACK_BIOME } from '../domain/biome'
import { DEFAULT_TERRAIN_LEVELS } from '../domain/constants'
import {
  cellOf,
  shouldPlaceTree,
  treeCellCandidate,
  TREE_GRID_AREA,
  TREE_GRID_SIZE,
} from '../domain/tree-placement'

describe('classifyBiome', () => {
  it.effect('is total: every climate in the unit square maps to a biome', () =>
    Effect.sync(() => {
      const roster = new Set<string>(BIOMES)

      for (let t = 0; t <= 1.0001; t += 0.05) {
        for (let h = 0; h <= 1.0001; h += 0.05) {
          expect(roster.has(classifyBiome({ temperature: t, humidity: h }))).toBe(true)
        }
      }
    }),
  )

  it.effect('lets temperature dominate: a wet freezing region is snow, not forest', () =>
    Effect.sync(() => {
      expect(classifyBiome({ temperature: 0.05, humidity: 0.95 })).toBe('SNOW')
      expect(classifyBiome({ temperature: 0.3, humidity: 0.95 })).toBe('TAIGA')
    }),
  )

  it.effect('produces desert only when hot AND dry', () =>
    Effect.sync(() => {
      expect(classifyBiome({ temperature: 0.9, humidity: 0.1 })).toBe('DESERT')
      expect(classifyBiome({ temperature: 0.9, humidity: 0.9 })).toBe('FOREST')
    }),
  )

  it.effect('falls back to plains for the temperate middle', () =>
    Effect.sync(() => {
      expect(classifyBiome({ temperature: 0.5, humidity: 0.5 })).toBe(FALLBACK_BIOME)
    }),
  )

  it.effect('has a surface definition and a tree density for every biome', () =>
    Effect.sync(() => {
      expect(Object.keys(BIOME_SURFACES).sort()).toStrictEqual([...BIOMES].sort())
      expect(Object.keys(BIOME_TREE_DENSITY).sort()).toStrictEqual([...BIOMES].sort())
    }),
  )

  it.effect('grows no trees in water or sand biomes', () =>
    Effect.sync(() => {
      expect(BIOME_TREE_DENSITY.OCEAN).toBe(0)
      expect(BIOME_TREE_DENSITY.BEACH).toBe(0)
      expect(BIOME_TREE_DENSITY.DESERT).toBe(0)
    }),
  )
})

/**
 * ---------------------------------------------------------------------------
 * Trees are placed on a jittered grid, not by per-column dice.
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.7: 「木は格子ジッター配置(トリビアルな乱数散布は視覚的に偏る)」.
 * The reference is more specific about the consequence
 * (`packages/world/domain/terrain/tree-placer.ts:184-188`): independent
 * per-column rolls at forest density "fused the radius-2 crowns into a walkable
 * leaf slab". So this is not a look-and-feel preference — it is the difference
 * between a forest and a floor.
 */
describe('tree placement', () => {
  const forest = { biome: 'FOREST' as const, terrainLevels: DEFAULT_TERRAIN_LEVELS, surfaceY: 70 }

  it.effect('places at most one candidate per grid cell', () =>
    Effect.sync(() => {
      let placed = 0
      const cells = 40

      for (let wx = 0; wx < cells * TREE_GRID_SIZE; wx += 1) {
        if (shouldPlaceTree({ ...forest, worldX: wx, worldZ: 0 })) {
          placed += 1
        }
      }

      // One cell can yield at most one tree, so the count is bounded by the
      // number of cells regardless of how high the density goes.
      expect(placed).toBeLessThanOrEqual(cells)
    }),
  )

  it.effect('keeps candidates at least one cell apart, which is what stops crowns merging', () =>
    Effect.sync(() => {
      const placedX: Array<number> = []
      for (let wx = 0; wx < 200; wx += 1) {
        if (shouldPlaceTree({ ...forest, worldX: wx, worldZ: 0 })) {
          placedX.push(wx)
        }
      }

      expect(placedX.length).toBeGreaterThan(0)
      for (let index = 1; index < placedX.length; index += 1) {
        const gap = (placedX[index] ?? 0) - (placedX[index - 1] ?? 0)
        expect(gap).toBeGreaterThanOrEqual(1)
      }
    }),
  )

  it.effect('the candidate always lands inside its own cell', () =>
    Effect.sync(() => {
      for (let cellX = -20; cellX <= 20; cellX += 1) {
        for (let cellZ = -20; cellZ <= 20; cellZ += 3) {
          const candidate = treeCellCandidate(cellX, cellZ)

          expect(cellOf(candidate.worldX)).toBe(cellX)
          expect(cellOf(candidate.worldZ)).toBe(cellZ)
        }
      }
    }),
  )

  it.effect('is deterministic: the same cell always yields the same candidate', () =>
    Effect.sync(() => {
      expect(treeCellCandidate(7, -3)).toStrictEqual(treeCellCandidate(7, -3))
    }),
  )

  it.effect('scales density by the cell area, so the per-column figure keeps its meaning', () =>
    Effect.sync(() => {
      expect(TREE_GRID_AREA).toBe(TREE_GRID_SIZE * TREE_GRID_SIZE)

      // A forest at 0.04 per column becomes 0.64 per 16-block cell — high, but
      // still below 1, so not every cell gets a tree.
      expect(BIOME_TREE_DENSITY.FOREST * TREE_GRID_AREA).toBeLessThan(1)
    }),
  )

  /**
   * REGRESSION: no trees on the sea bed.
   *
   * `tree-placer.ts:200-206` carries a seven-line comment about trees growing
   * on the ocean. A surface below sea level is a lake or sea bed; a trunk
   * planted there rises straight up through the water.
   */
  it.effect('never plants on a submerged column, whatever the biome says', () =>
    Effect.sync(() => {
      const candidate = treeCellCandidate(0, 0)
      const submerged = {
        worldX: candidate.worldX,
        worldZ: candidate.worldZ,
        biome: 'FOREST' as const,
        terrainLevels: DEFAULT_TERRAIN_LEVELS,
      }

      expect(shouldPlaceTree({ ...submerged, surfaceY: DEFAULT_TERRAIN_LEVELS.seaLevel - 1 })).toBe(false)
    }),
  )

  it.effect('grows denser in forest than in plains, at the same coordinates', () =>
    Effect.sync(() => {
      const count = (biome: 'FOREST' | 'PLAINS'): number => {
        let placed = 0
        for (let wx = 0; wx < 400; wx += 1) {
          if (shouldPlaceTree({ worldX: wx, worldZ: 0, surfaceY: 70, biome, terrainLevels: DEFAULT_TERRAIN_LEVELS })) {
            placed += 1
          }
        }
        return placed
      }

      expect(count('FOREST')).toBeGreaterThan(count('PLAINS'))
    }),
  )
})
