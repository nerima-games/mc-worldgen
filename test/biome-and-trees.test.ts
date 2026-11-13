import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { blockAxis } from './fixtures/validated-inputs'
import { BIOMES, BIOME_SURFACES, BIOME_TREE_DENSITY, KERNEL_BIOMES, classifyBiome } from '../src/domain/biome'
import { DEFAULT_TERRAIN_LEVELS } from '../src/domain/constants'
import {
  cellOf,
  AVAILABLE_TREE_SPECIES,
  KERNEL_BIOME_TREE_DENSITY,
  shouldPlaceTree,
  treeCellCandidate,
  TREE_CELL_JITTER_ORIGIN,
  TREE_CELL_JITTER_SPAN,
  TREE_GRID_AREA,
  TREE_GRID_SIZE,
  TREE_MIN_SPACING,
  UNAVAILABLE_TREE_SPECIES,
  treeConfigurationForBiome,
  treeTrunkHeightForConfiguration,
} from '../src/domain/tree-placement'

const EXPECTED_OAK_SHAPE_BY_BIOME: Readonly<Record<string, 'dense' | 'sparse' | 'low'>> = {
  FLOWER_FOREST: 'dense',
  FOREST: 'dense',
  MOUNTAINS: 'low',
  PLAINS: 'sparse',
  SWAMP: 'sparse',
  dappled_forest: 'dense',
  flower_forest: 'dense',
  forest: 'dense',
  meadow: 'sparse',
  plains: 'sparse',
  sparse_jungle: 'sparse',
  swamp: 'sparse',
  sunflower_plains: 'sparse',
  windswept_forest: 'sparse',
  windswept_gravelly_hills: 'low',
  windswept_hills: 'low',
  wooded_badlands: 'low',
}

const EXPECTED_TREE_RANGES = {
  dense: { density: [0.01, 0.012], height: [5, 7] },
  low: { density: [0.002, 0.004], height: [2, 3] },
  none: { density: [0, 0], height: [0, 0] },
  sparse: { density: [0.003, 0.006], height: [4, 5] },
} as const

const EXPECTED_PLACEMENT_DENSITY_RANGES = {
  dense: [0.011, 0.013],
  low: [0.0025, 0.0045],
  none: [0, 0],
  sparse: [0.0025, 0.0065],
} as const

const shouldPlaceTreeSuccessfully = (input: Parameters<typeof shouldPlaceTree>[0]): boolean => {
  const result = shouldPlaceTree(input)
  expect(result).toMatchObject({ _tag: 'Success' })
  return result._tag === 'Success' && result.success
}

describe('classifyBiome', () => {
  it.effect('is total: every climate in the unit square maps to a biome', () =>
    Effect.sync(() => {
      const roster = new Set<string>(BIOMES)

      for (let t = 0; t <= 1.0001; t += 0.05) {
        for (let h = 0; h <= 1.0001; h += 0.05) {
          expect(roster.has(classifyBiome(t, h))).toBe(true)
        }
      }
    }),
  )

  it.effect('classifies cold extremes and wet cold climates separately', () =>
    Effect.sync(() => {
      expect(classifyBiome(0.05, 0.1)).toBe('SNOW')
      expect(classifyBiome(0.2, 0.95)).toBe('TAIGA')
    }),
  )

  it.effect('produces desert only when hot AND dry', () =>
    Effect.sync(() => {
      expect(classifyBiome(0.9, 0.1)).toBe('DESERT')
      expect(classifyBiome(0.9, 0.9)).toBe('JUNGLE')
    }),
  )

  it.effect('falls back to plains for the temperate middle', () =>
    Effect.sync(() => {
      expect(classifyBiome(0.5, 0.5)).toBe('PLAINS')
    }),
  )

  it.effect('has a surface definition and a tree density for every biome', () =>
    Effect.sync(() => {
      expect(Object.keys(BIOME_SURFACES).sort()).toStrictEqual([...BIOMES].sort())
      expect(Object.keys(BIOME_TREE_DENSITY).sort()).toStrictEqual([...BIOMES].sort())
    }),
  )

  it.effect('has a bounded oak-tree density for every concrete kernel biome', () =>
    Effect.sync(() => {
      expect(Object.keys(KERNEL_BIOME_TREE_DENSITY).sort()).toStrictEqual([...KERNEL_BIOMES].sort())
      for (const [biome, density] of Object.entries(KERNEL_BIOME_TREE_DENSITY)) {
        expect(Number.isFinite(density), `${biome} density should be finite`).toBe(true)
        expect(density, `${biome} density should be a probability`).toBeGreaterThanOrEqual(0)
        expect(density, `${biome} density should be a probability`).toBeLessThanOrEqual(1)
      }
      expect(AVAILABLE_TREE_SPECIES).toStrictEqual(['oak'])
      expect(UNAVAILABLE_TREE_SPECIES).toContain('birch')
      expect(UNAVAILABLE_TREE_SPECIES).toContain('spruce')
      expect(UNAVAILABLE_TREE_SPECIES).toContain('poplar')
    }),
  )

  it.effect('maps every biome to its specified oak shape, density, and height range', () =>
    Effect.sync(() => {
      for (const biome of [...BIOMES, ...KERNEL_BIOMES]) {
        const shape = EXPECTED_OAK_SHAPE_BY_BIOME[biome] ?? 'none'
        const expected = EXPECTED_TREE_RANGES[shape]
        const result = treeConfigurationForBiome(biome)

        expect(result._tag, `${biome} must have an explicit configuration`).toBe('Success')
        if (result._tag === 'Success') {
          expect(result.success.shape, biome).toBe(shape)
          expect(result.success.species, biome).toBe(shape === 'none' ? null : 'oak')
          expect(result.success.density, biome).toBeGreaterThanOrEqual(expected.density[0])
          expect(result.success.density, biome).toBeLessThanOrEqual(expected.density[1])
          expect(result.success.trunkHeightMin, biome).toBe(expected.height[0])
          expect(result.success.trunkHeightMax, biome).toBe(expected.height[1])
        }
      }
    }),
  )

  it.effect('returns a typed failure for a biome without a configuration', () =>
    Effect.sync(() => {
      const result = treeConfigurationForBiome('unlisted_biome')
      const nonStringBiome = treeConfigurationForBiome(42)
      const placement = shouldPlaceTree({
        biome: 'unlisted_biome',
        surfaceY: blockAxis(70),
        terrainLevels: DEFAULT_TERRAIN_LEVELS,
        worldX: 0,
        worldZ: 0,
      })

      expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'UnsupportedTreeBiome' } })
      expect(nonStringBiome).toMatchObject({ _tag: 'Failure', failure: { _tag: 'UnsupportedTreeBiome' } })
      expect(placement).toMatchObject({ _tag: 'Failure', failure: { _tag: 'UnsupportedTreeBiome' } })
    }),
  )

  it.effect('does not substitute oak in biomes whose vanilla tree species is unavailable', () =>
    Effect.sync(() => {
      for (const biome of [
        'birch_forest',
        'old_growth_birch_forest',
        'taiga',
        'old_growth_spruce_taiga',
        'jungle',
        'savanna',
        'dark_forest',
        'mangrove_swamp',
        'cherry_grove',
        'pale_garden',
      ]) {
        const result = treeConfigurationForBiome(biome)
        expect(result).toMatchObject({ _tag: 'Success', success: { species: null, density: 0, shape: 'none' } })
      }
    }),
  )

  it.effect('places trees only where expected and within the specified density for every biome', () =>
    Effect.sync(() => {
      const cellSpan = 40
      const sampleArea = cellSpan * cellSpan * TREE_GRID_AREA

      for (const biome of [...BIOMES, ...KERNEL_BIOMES]) {
        const shape = EXPECTED_OAK_SHAPE_BY_BIOME[biome] ?? 'none'
        const expectedDensity = EXPECTED_PLACEMENT_DENSITY_RANGES[shape]
        let treeCount = 0

        for (let cellX = 0; cellX < cellSpan; cellX += 1) {
          for (let cellZ = 0; cellZ < cellSpan; cellZ += 1) {
            const candidate = treeCellCandidate(cellX, cellZ)
            const result = shouldPlaceTree({
              worldX: blockAxis(candidate.worldX),
              worldZ: blockAxis(candidate.worldZ),
              surfaceY: blockAxis(70),
              biome,
              terrainLevels: DEFAULT_TERRAIN_LEVELS,
            })

            expect(result._tag, biome).toBe('Success')
            if (result._tag === 'Success' && result.success) {
              treeCount += 1
            }
          }
        }

        if (shape === 'none') {
          expect(treeCount, biome).toBe(0)
        } else {
          const density = treeCount / sampleArea
          expect(treeCount, biome).toBeGreaterThan(0)
          expect(density, biome).toBeGreaterThanOrEqual(expectedDensity[0])
          expect(density, biome).toBeLessThanOrEqual(expectedDensity[1])
        }
      }
    }),
  )

  it.effect('chooses deterministic trunk heights inside each biome shape range', () =>
    Effect.sync(() => {
      for (const biome of [...BIOMES, ...KERNEL_BIOMES]) {
        const shape = EXPECTED_OAK_SHAPE_BY_BIOME[biome] ?? 'none'
        const expected = EXPECTED_TREE_RANGES[shape]
        const result = treeConfigurationForBiome(biome)
        expect(result._tag).toBe('Success')
        if (result._tag === 'Success') {
          for (let cellX = -12; cellX <= 12; cellX += 3) {
            const candidate = treeCellCandidate(cellX, -cellX)
            const height = treeTrunkHeightForConfiguration(result.success, candidate.cellRng)
            expect(height).toBeGreaterThanOrEqual(expected.height[0])
            expect(height).toBeLessThanOrEqual(expected.height[1])
            expect(treeTrunkHeightForConfiguration(result.success, candidate.cellRng)).toBe(height)
          }
        }
      }
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
        if (shouldPlaceTreeSuccessfully({ worldX: blockAxis(wx), worldZ: blockAxis(wz), surfaceY: blockAxis(70), biome, terrainLevels: DEFAULT_TERRAIN_LEVELS })) {
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

      const cellsUsed = new Set(placed.map(([wx, wz]) => `${String(cellOf(blockAxis(wx)))},${String(cellOf(blockAxis(wz)))}`))
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

      expect(shouldPlaceTreeSuccessfully({ ...submerged, surfaceY: blockAxis(DEFAULT_TERRAIN_LEVELS.seaLevel - 1) })).toBe(false)
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
