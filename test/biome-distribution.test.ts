import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Result } from 'effect'
import { classifyMinecraftBiomeFromClimate, minecraftBiomeFor, minecraftClimateAt } from '@nerima-games/mc-noise'
import { BIOMES, KERNEL_BIOMES, type BiomeType, type KernelBiomeType } from '../src/domain/biome'
import { classifyBiomeFromClimate } from '../src/domain/biome-classifier'
import { CHUNK_SIZE_XZ, DEFAULT_TERRAIN_LEVELS } from '../src/domain/constants'
import { createTerrainDensitySampler } from '../src/domain/density-function'
import { climateAt, resolveTerrainColumn, resolveTerrainColumnForGeneration } from '../src/domain/terrain-column'
import { biomeFor, generateChunkAt, surfaceBiomeAt, terrainColumnAt } from '../src/domain/terrain'
import { blockAxis, chunkAxis, noiseSeed } from './fixtures/validated-inputs'

const SURVEY_CONFIGS = [
  { seed: 20260726, stride: 128 },
  { seed: 1, stride: 128 },
  { seed: 4242, stride: 128 },
  { seed: 999983, stride: 128 },
  { seed: 77777, stride: 128 },
] as const
const SURVEY_SPAN = 8192
const SURVEY_SEEDS = SURVEY_CONFIGS.map(({ seed }) => seed)
const TEMPERATURE_WAVELENGTH_BLOCKS = 320
const HUMIDITY_WAVELENGTH_BLOCKS = 280
const CONTINENTALNESS_WAVELENGTH_BLOCKS = 180
const LONGEST_BIOME_WAVELENGTH_BLOCKS = Math.max(
  TEMPERATURE_WAVELENGTH_BLOCKS,
  HUMIDITY_WAVELENGTH_BLOCKS,
  CONTINENTALNESS_WAVELENGTH_BLOCKS,
)
const SEA_LEVEL_MIN_SHARE = 0.33
const SEA_LEVEL_MAX_SHARE = 0.5
const LEGACY_DRY_COLUMN = { wx: 0, wz: 0 }
const LEGACY_LAKE_COLUMN = { wx: -512, wz: -96 }

const OCEAN_BIOMES: ReadonlySet<KernelBiomeType> = new Set([
  'cold_ocean',
  'deep_cold_ocean',
  'deep_frozen_ocean',
  'deep_ocean',
  'lukewarm_ocean',
  'ocean',
  'warm_ocean',
])
const MOUNTAIN_BIOMES: ReadonlySet<KernelBiomeType> = new Set([
  'cherry_grove',
  'frozen_peaks',
  'grove',
  'jagged_peaks',
  'meadow',
  'snowy_slopes',
  'stony_peaks',
  'windswept_forest',
  'windswept_gravelly_hills',
  'windswept_hills',
])

type GeneratedColumn = Readonly<{
  readonly coarseBiome: BiomeType
  readonly kernelBiome: KernelBiomeType
  readonly surfaceY: number
}>

type BiomeSurvey = Readonly<{
  readonly seed: number
  readonly stride: number
  readonly columns: ReadonlyArray<GeneratedColumn>
  readonly coarseCounts: ReadonlyMap<BiomeType, number>
  readonly kernelCounts: ReadonlyMap<KernelBiomeType, number>
  readonly belowSea: number
  readonly submergedButDry: number
  readonly shorelineBand: number
  readonly beach: number
}>

const surveySeed = (seedValue: number, stride: number): BiomeSurvey => {
  const seed = noiseSeed(seedValue)
  const sampler = Result.getOrThrow(createTerrainDensitySampler(seed))
  const columns: Array<GeneratedColumn> = []
  const coarseCounts = new Map<BiomeType, number>()
  const kernelCounts = new Map<KernelBiomeType, number>()
  const half = SURVEY_SPAN / 2
  let belowSea = 0
  let submergedButDry = 0
  let shorelineBand = 0
  let beach = 0

  for (let dz = 0; dz < SURVEY_SPAN; dz += stride) {
    for (let dx = 0; dx < SURVEY_SPAN; dx += stride) {
      const wx = dx - half
      const wz = dz - half
      const sample = sampler.surfaceHeightAt(blockAxis(wx), blockAxis(wz))
      if (Result.isFailure(sample)) {
        throw new Error(`surface sample failed for seed ${String(seedValue)} at ${String(wx)},${String(wz)}: ${sample.failure.message}`)
      }
      const surfaceY = sample.success
      const column = Result.getOrThrow(
        resolveTerrainColumnForGeneration(seed, blockAxis(wx), blockAxis(wz), DEFAULT_TERRAIN_LEVELS, surfaceY),
      )
      const generated = { coarseBiome: column.biome, kernelBiome: column.kernelBiome, surfaceY }
      columns.push(generated)
      coarseCounts.set(generated.coarseBiome, (coarseCounts.get(generated.coarseBiome) ?? 0) + 1)
      kernelCounts.set(generated.kernelBiome, (kernelCounts.get(generated.kernelBiome) ?? 0) + 1)

      const belowWaterline = surfaceY < DEFAULT_TERRAIN_LEVELS.seaLevel
      if (belowWaterline) {
        belowSea += 1
        if (generated.coarseBiome !== 'OCEAN' && generated.coarseBiome !== 'BEACH') {
          submergedButDry += 1
        }
      }
      if (
        surfaceY >= DEFAULT_TERRAIN_LEVELS.seaLevel - 2 &&
        surfaceY <= DEFAULT_TERRAIN_LEVELS.seaLevel + 1
      ) {
        shorelineBand += 1
      }
      if (generated.coarseBiome === 'BEACH') {
        beach += 1
      }
    }
  }

  return {
    seed: seedValue,
    stride,
    columns,
    coarseCounts,
    kernelCounts,
    belowSea,
    submergedButDry,
    shorelineBand,
    beach,
  }
}

const surveys = SURVEY_CONFIGS.map(({ seed, stride }) => surveySeed(seed, stride))
const generatedColumns = surveys.flatMap(({ columns }) => columns)
const countMatching = (predicate: (column: GeneratedColumn) => boolean): number =>
  generatedColumns.filter(predicate).length
const shareOf = (counts: ReadonlyMap<BiomeType, number>, total: number, biome: BiomeType): number =>
  (counts.get(biome) ?? 0) / total

// The 8-block density lattice shifts the shoreline compared with exact per-voxel sampling.
const COARSE_BIOME_SHARE_BOUNDS: ReadonlyArray<readonly [BiomeType, number, number]> = [
  ['OCEAN', 0.2, 0.5],
  ['BEACH', 0.065, 0.28],
  ['PLAINS', 0.04, 0.15],
  ['FOREST', 0.03, 0.15],
  ['DESERT', 0.03, 0.1],
  ['SNOW', 0.02, 0.1],
  ['TAIGA', 0.03, 0.12],
  ['SAVANNA', 0.02, 0.08],
  ['JUNGLE', 0.02, 0.08],
  ['RIVER', 0.01, 0.05],
  ['MOUNTAINS', 0.01, 0.08],
  ['FLOWER_FOREST', 0.003, 0.03],
  ['SWAMP', 0.0005, 0.005],
]

describe('generated biome distribution', () => {
  it.effect('keeps the legacy column query usable for dry land and lake basins', () => Effect.sync(() => {
    const seed = noiseSeed(20260726)
    const dry = resolveTerrainColumn(seed, LEGACY_DRY_COLUMN.wx, LEGACY_DRY_COLUMN.wz, DEFAULT_TERRAIN_LEVELS)
    const lake = resolveTerrainColumn(seed, LEGACY_LAKE_COLUMN.wx, LEGACY_LAKE_COLUMN.wz, DEFAULT_TERRAIN_LEVELS)

    expect(Option.isNone(dry.lakeBasinY)).toBe(true)
    expect(dry.waterLevel).toBeNull()
    expect(Option.isSome(lake.lakeBasinY)).toBe(true)
    expect(lake.waterLevel).not.toBeNull()
    if (Option.isSome(lake.lakeBasinY)) {
      expect(lake.surfaceY).toBe(lake.lakeBasinY.value)
    }
  }))

  it.effect('matches mc-noise biome queries while sharing one climate sample', () =>
    Effect.sync(() => {
      const seed = noiseSeed(51821)
      const levels = {
        lakeLevel: blockAxis(DEFAULT_TERRAIN_LEVELS.lakeLevel),
        seaLevel: blockAxis(DEFAULT_TERRAIN_LEVELS.seaLevel),
      }
      const positions = [
        { wx: -721, wz: 384 },
        { wx: -128, wz: -256 },
        { wx: -1, wz: 0 },
        { wx: 43, wz: 256 },
        { wx: 512, wz: -777 },
      ]
      const surfaceHeights = [1, 60, 61, 62, 63, 64, 65, 82, 120, 180, 210]

      for (const { wx, wz } of positions) {
        for (const surfaceY of surfaceHeights) {
          const generated = Result.getOrThrow(
            resolveTerrainColumnForGeneration(seed, blockAxis(wx), blockAxis(wz), DEFAULT_TERRAIN_LEVELS, blockAxis(surfaceY)),
          )
          const expected = Result.getOrThrow(
            minecraftBiomeFor({
              levels,
              seed,
              surfaceY: blockAxis(surfaceY),
              wx: blockAxis(wx),
              wz: blockAxis(wz),
            }),
          )
          expect(generated.biome).toBe(expected)
        }
      }
    }),
  )

  it.effect('surveys five fixed seeds across at least 25 longest-climate wavelengths', () =>
    Effect.sync(() => {
      expect(surveys).toHaveLength(SURVEY_SEEDS.length)
      expect(SURVEY_SPAN / LONGEST_BIOME_WAVELENGTH_BLOCKS).toBeGreaterThanOrEqual(25)
      for (const survey of surveys) {
        expect(survey.columns).toHaveLength((SURVEY_SPAN / survey.stride) ** 2)
      }
      const expectedColumnCount = SURVEY_CONFIGS.reduce(
        (total, { stride }) => total + (SURVEY_SPAN / stride) ** 2,
        0,
      )
      expect(generatedColumns).toHaveLength(expectedColumnCount)
    }),
  )

  it.effect('reaches every coarse category and emits only registered kernel biomes', () =>
    Effect.sync(() => {
      for (const survey of surveys) {
        expect(survey.coarseCounts.size).toBe(BIOMES.length)
        for (const biome of BIOMES) {
          expect(survey.coarseCounts.get(biome) ?? 0, `${biome} missing on seed ${String(survey.seed)}`).toBeGreaterThan(0)
        }
      }

      for (const { coarseBiome, kernelBiome } of generatedColumns) {
        expect(BIOMES).toContain(coarseBiome)
        expect(KERNEL_BIOMES).toContain(kernelBiome)
      }
    }),
  )

  it.effect('keeps each coarse-biome share inside its multi-seed terrain-grid band', () =>
    Effect.sync(() => {
      const shares = surveys.flatMap((survey) =>
        COARSE_BIOME_SHARE_BOUNDS.map(([biome]) => ({
          seed: survey.seed,
          biome,
          share: shareOf(survey.coarseCounts, survey.columns.length, biome),
        })),
      )
      const violations = shares.filter(({ biome, share }) => {
        const bounds = COARSE_BIOME_SHARE_BOUNDS.find(([candidate]) => candidate === biome)
        return bounds === undefined || share < bounds[1] || share > bounds[2]
      })

      expect(violations, `measured coarse-biome shares: ${JSON.stringify(shares)}`).toStrictEqual([])
    }),
  )

  // mc-noise applies OCEAN below seaLevel - 2 and BEACH through seaLevel + 1;
  // above that it returns the climate classifier, which can itself return OCEAN.
  it.effect('preserves submerged and shoreline classification boundaries for every seed', () =>
    Effect.sync(() => {
      const belowSeaShares = surveys.map((survey) => ({
        seed: survey.seed,
        share: survey.belowSea / survey.columns.length,
      }))
      const outsideRange = belowSeaShares.filter(
        ({ share }) => share <= SEA_LEVEL_MIN_SHARE || share >= SEA_LEVEL_MAX_SHARE,
      )

      expect(outsideRange, `measured below-sea shares: ${JSON.stringify(belowSeaShares)}`).toStrictEqual([])
      for (const survey of surveys) {
        expect(survey.submergedButDry).toBe(0)
        expect(survey.shorelineBand).toBeGreaterThan(0)
        expect(survey.beach).toBe(survey.shorelineBand)
      }
    }),
  )

  it.effect('stores only concrete kernel biome ids in generated chunk columns', () =>
    Effect.sync(() => {
      const chunk = Result.getOrThrow(generateChunkAt(noiseSeed(SURVEY_CONFIGS[0].seed), chunkAxis(0), chunkAxis(0), { decorate: false }))
      expect(chunk.biomes).toHaveLength(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ)
      for (const biome of chunk.biomes) {
        expect(KERNEL_BIOMES).toContain(biome)
        expect((BIOMES as ReadonlyArray<string>).includes(biome)).toBe(false)
      }
    }),
  )

  it.effect('generates oceans, deep oceans, and concrete mountain refinements', () =>
    Effect.sync(() => {
      expect(countMatching(({ kernelBiome }) => OCEAN_BIOMES.has(kernelBiome))).toBeGreaterThan(0)
      expect(countMatching(({ kernelBiome }) => kernelBiome.startsWith('deep_') && OCEAN_BIOMES.has(kernelBiome))).toBeGreaterThan(0)
      expect(countMatching(({ coarseBiome }) => coarseBiome === 'MOUNTAINS')).toBeGreaterThan(0)
      expect(countMatching(({ coarseBiome, kernelBiome }) => coarseBiome === 'MOUNTAINS' && MOUNTAIN_BIOMES.has(kernelBiome))).toBeGreaterThan(0)
      expect(countMatching(({ kernelBiome }) => MOUNTAIN_BIOMES.has(kernelBiome))).toBeGreaterThan(0)
    }),
  )

  it.effect('keeps every deep ocean at or below the deep-water surface threshold', () =>
    Effect.sync(() => {
      const deepOceanColumns = generatedColumns.filter(({ kernelBiome }) => kernelBiome.startsWith('deep_'))
      expect(deepOceanColumns.length).toBeGreaterThan(0)
      for (const column of deepOceanColumns) {
        expect(column.surfaceY).toBeLessThanOrEqual(30)
      }
    }),
  )
})

describe('the public climate query', () => {
  it.effect('matches the pinned mc-noise climate API without Result-wrapped per-column sampling', () =>
    Effect.sync(() => {
      const coordinates = Array.from({ length: 32 }, (_, index) => ({
        wx: blockAxis(-321 + index * 73),
        wz: blockAxis(811 - index * 41),
      }))

      for (const seedValue of [SURVEY_CONFIGS[0].seed, SURVEY_CONFIGS[2].seed, SURVEY_CONFIGS[4].seed]) {
        const seed = noiseSeed(seedValue)
        for (const { wx, wz } of coordinates) {
          const expected = Result.getOrThrow(minecraftClimateAt(seed, wx, wz))
          const actual = climateAt(seed, wx, wz)
          expect(actual).toStrictEqual(expected)
          expect(classifyBiomeFromClimate(actual)).toBe(classifyMinecraftBiomeFromClimate(expected))
        }
      }
    }),
  )

  it.effect('is deterministic and position-dependent', () =>
    Effect.sync(() => {
      const seed = noiseSeed(SURVEY_CONFIGS[0].seed)
      const first = climateAt(seed, blockAxis(100), blockAxis(200))
      expect(climateAt(seed, blockAxis(100), blockAxis(200))).toStrictEqual(first)
      expect(climateAt(seed, blockAxis(6000), blockAxis(-6000))).not.toStrictEqual(first)
    }),
  )

  it.effect('keeps climate fields inside their primitive ranges', () =>
    Effect.sync(() => {
      const sample = climateAt(noiseSeed(SURVEY_CONFIGS[0].seed), blockAxis(-4096), blockAxis(3072))
      expect(sample.temperature).toBeGreaterThanOrEqual(0)
      expect(sample.temperature).toBeLessThan(1)
      expect(sample.humidity).toBeGreaterThanOrEqual(0)
      expect(sample.humidity).toBeLessThan(1)
      expect(sample.riverNoise).toBeGreaterThanOrEqual(0)
      expect(sample.riverNoise).toBeLessThan(1)
      expect(sample.continentalness).toBeGreaterThanOrEqual(-1)
      expect(sample.continentalness).toBeLessThan(1)
      expect(sample.erosion).toBeGreaterThanOrEqual(-1)
      expect(sample.erosion).toBeLessThan(1)
      expect(Number.isFinite(sample.pv)).toBe(true)
    }),
  )
})

describe('the public biome and terrain-column queries', () => {
  it.effect('applies ocean and beach overrides before using the climate classifier', () => Effect.sync(() => {
    const seed = noiseSeed(SURVEY_CONFIGS[0].seed)
    const wx = blockAxis(0)
    const wz = blockAxis(0)
    const biomeAt = (surfaceY: number) => biomeFor(seed, wx, wz, blockAxis(surfaceY), DEFAULT_TERRAIN_LEVELS)

    expect(biomeAt(60)).toBe('OCEAN')
    expect(biomeAt(61)).toBe('BEACH')
    expect(biomeAt(64)).toBe('BEACH')
    expect(biomeAt(65)).toBe(classifyBiomeFromClimate(climateAt(seed, wx, wz)))
  }))

  it.effect('shares the surface biome with an explicit biome query at the resolved height', () => Effect.sync(() => {
    const seed = noiseSeed(SURVEY_CONFIGS[0].seed)
    const wx = blockAxis(-721)
    const wz = blockAxis(384)
    const surface = surfaceBiomeAt(seed, wx, wz, DEFAULT_TERRAIN_LEVELS)

    expect(Number.isSafeInteger(surface.surfaceY)).toBe(true)
    expect(BIOMES).toContain(surface.biome)
    expect(biomeFor(seed, wx, wz, surface.surfaceY, DEFAULT_TERRAIN_LEVELS)).toBe(surface.biome)
  }))

  it.effect('uses the default terrain levels when called with three arguments', () => Effect.sync(() => {
    const seed = noiseSeed(SURVEY_CONFIGS[0].seed)
    const wx = blockAxis(0)
    const wz = blockAxis(0)

    expect(terrainColumnAt(seed, wx, wz)).toStrictEqual(
      terrainColumnAt(seed, wx, wz, DEFAULT_TERRAIN_LEVELS),
    )
  }))
})
