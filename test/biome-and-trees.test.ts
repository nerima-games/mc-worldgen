import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { BIOMES, BIOME_SURFACES, BIOME_TREE_DENSITY, classifyBiome, FALLBACK_BIOME } from '../domain/biome'
import { DEFAULT_TERRAIN_LEVELS } from '../domain/constants'
import {
  cellOf,
  shouldPlaceTree,
  treeCellCandidate,
  TREE_CELL_JITTER_ORIGIN,
  TREE_CELL_JITTER_SPAN,
  TREE_GRID_AREA,
  TREE_GRID_SIZE,
  TREE_MIN_SPACING,
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
  /**
   * These sweeps are two-dimensional on purpose.
   *
   * The first version of this file swept a single line `worldZ = 0` and counted
   * hits. That worked only by accident: with the jitter free to cover the whole
   * cell, some cell on any given line had its candidate on that line. Confining
   * the jitter to a window (`TREE_CELL_JITTER_ORIGIN`) makes 5 of every 8 world
   * lines contain no candidate at all, and the line sweep silently measured
   * zero trees and asserted nothing. A placement test that scans fewer
   * dimensions than the placement has is a test that can go vacuous under a
   * change to the very thing it is testing.
   */
  const placedIn = (
    biome: 'FOREST' | 'PLAINS',
    span: number,
  ): ReadonlyArray<readonly [number, number]> => {
    const placed: Array<readonly [number, number]> = []
    for (let wx = 0; wx < span; wx += 1) {
      for (let wz = 0; wz < span; wz += 1) {
        if (shouldPlaceTree({ worldX: wx, worldZ: wz, surfaceY: 70, biome, terrainLevels: DEFAULT_TERRAIN_LEVELS })) {
          placed.push([wx, wz])
        }
      }
    }
    return placed
  }

  it.effect('places at most one candidate per grid cell', () =>
    Effect.sync(() => {
      const cells = 12
      const placed = placedIn('FOREST', cells * TREE_GRID_SIZE)

      expect(placed.length).toBeGreaterThan(0)
      // One cell can yield at most one tree, so the count is bounded by the
      // number of cells regardless of how high the density goes.
      expect(placed.length).toBeLessThanOrEqual(cells * cells)

      const cellsUsed = new Set(placed.map(([wx, wz]) => `${String(cellOf(wx))},${String(cellOf(wz))}`))
      expect(cellsUsed.size).toBe(placed.length)
    }),
  )

  /**
   * REGRESSION, docs/testing.md §4-b F-2.
   *
   * This test used to be called "keeps candidates at least one cell apart,
   * which is what stops crowns merging" and asserted `gap >= 1` — a gap of at
   * least one block between two distinct columns, which is true of any two
   * distinct columns and therefore asserted nothing. It agreed with a header
   * comment claiming the grid "bounds the minimum spacing by construction", and
   * between them they made a false claim look tested. Measured spacing was 1.
   *
   * The bound is now real and it is named: `TREE_MIN_SPACING`. The full
   * consequence — that no two crowns fuse in generated blocks — is in
   * `test/tree-canopy.test.ts`.
   */
  it.effect('keeps candidates TREE_MIN_SPACING apart, which is what stops crowns merging', () =>
    Effect.sync(() => {
      const placed = placedIn('FOREST', 24 * TREE_GRID_SIZE)
      expect(placed.length).toBeGreaterThan(50)

      let closest = Number.POSITIVE_INFINITY
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          const left = placed[i] ?? [0, 0]
          const right = placed[j] ?? [0, 0]
          closest = Math.min(closest, Math.max(Math.abs(left[0] - right[0]), Math.abs(left[1] - right[1])))
        }
      }

      expect(closest).toBeGreaterThanOrEqual(TREE_MIN_SPACING)
      // Not vacuous: the bound is TIGHT, so a grid that merely happened to be
      // sparse here would not pass. Some pair really does sit at exactly the
      // minimum.
      expect(closest).toBe(TREE_MIN_SPACING)
    }),
  )

  it.effect('the candidate always lands inside its own cell, in the jitter window', () =>
    Effect.sync(() => {
      for (let cellX = -20; cellX <= 20; cellX += 1) {
        for (let cellZ = -20; cellZ <= 20; cellZ += 3) {
          const candidate = treeCellCandidate(cellX, cellZ)

          expect(cellOf(candidate.worldX)).toBe(cellX)
          expect(cellOf(candidate.worldZ)).toBe(cellZ)

          // Tighter than "inside its cell": inside the WINDOW. The gutter
          // between the window and the cell edge is the minimum-spacing
          // guarantee, and it exists only if this holds for negative cells too
          // — which is why the sweep starts at -20.
          for (const offset of [candidate.worldX - cellX * TREE_GRID_SIZE, candidate.worldZ - cellZ * TREE_GRID_SIZE]) {
            expect(offset).toBeGreaterThanOrEqual(TREE_CELL_JITTER_ORIGIN)
            expect(offset).toBeLessThan(TREE_CELL_JITTER_ORIGIN + TREE_CELL_JITTER_SPAN)
          }
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

      // Every density must stay below 1 after the conversion. At or above 1 the
      // roll can never fail, every cell in the biome gets a tree, and the grid
      // degenerates into a lattice — at which point the density constant has
      // stopped being a probability and started being a lie. The densest biome
      // is the one that can break this.
      for (const biome of BIOMES) {
        expect((BIOME_TREE_DENSITY[biome] ?? 0) * TREE_GRID_AREA).toBeLessThan(1)
      }
    }),
  )

  /**
   * REGRESSION, docs/testing.md §4-b F-2 — the reason FOREST moved from 0.04.
   *
   * A minimum spacing of `s` packs at most one tree per `s x s` block, so no
   * arrangement of non-fusing radius-2 crowns can exceed 1/36 trees per column.
   * FOREST asked for 0.04 and TAIGA for 0.03; both were over that ceiling, so
   * the fused canopy was not a placement bug but the only way to honour the
   * number. This pins the ceiling rather than the two values, so a future
   * densification has to argue with the geometry.
   */
  it.effect('asks for no more trees than a non-fusing canopy can hold', () =>
    Effect.sync(() => {
      const ceiling = 1 / (TREE_MIN_SPACING * TREE_MIN_SPACING)

      for (const biome of BIOMES) {
        expect(BIOME_TREE_DENSITY[biome] ?? 0).toBeLessThanOrEqual(ceiling)
      }
      expect(BIOME_TREE_DENSITY.FOREST).toBeGreaterThan(0)
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
      const forestCount = placedIn('FOREST', 200).length
      const plainsCount = placedIn('PLAINS', 200).length

      expect(plainsCount).toBeGreaterThan(0)
      expect(forestCount).toBeGreaterThan(plainsCount)
    }),
  )
})
