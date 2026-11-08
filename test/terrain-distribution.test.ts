import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, DEFAULT_TERRAIN_LEVELS } from '../src/domain/constants'
import { createTerrainDensitySampler, MAX_SURFACE_Y, MIN_SURFACE_Y, type TerrainDensitySampler } from '../src/domain/density-function'
import { generateChunkAt } from '../src/domain/terrain'
import { chunkAxis, noiseSeed } from './fixtures/validated-inputs'

const SURVEY_CONFIGS = [
  { seed: 20260726, stride: 128 },
  { seed: 1, stride: 128 },
  { seed: 4242, stride: 128 },
  { seed: 999983, stride: 128 },
  { seed: 77777, stride: 128 },
] as const
const SURVEY_SEEDS = SURVEY_CONFIGS.map(({ seed }) => seed)
const SURVEY_SPAN = 8192
/** The broad density layer sets continent-scale relief at roughly this wavelength. */
const BROAD_RELIEF_WAVELENGTH_BLOCKS = 320
const MIN_BROAD_RELIEF_WAVELENGTHS = 25
const SURFACE_THRESHOLD = 0
const MAX_BOUNDARY_HIT_SHARE = 0.01
const SEA_LEVEL_MIN_SHARE = 0.33
const SEA_LEVEL_MAX_SHARE = 0.5
const MEDIAN_SURFACE_MIN = 60
const MEDIAN_SURFACE_MAX = 170
const MIN_SURFACE_RELIEF = 80
const HEIGHT_MEDIAN_FRACTION = 0.5
const HEIGHT_P95_FRACTION = 0.95
const OVERHANG_SCAN_MIN_Y = 40
const OVERHANG_SCAN_MAX_Y = 180
const OVERHANG_SCAN_STEP = 1
const OVERHANG_GRID_START = -384
const OVERHANG_GRID_END = 384
const OVERHANG_GRID_STRIDE = 16
const OVERHANG_SIGN_CHANGE_MINIMUM = 3

type TerrainSurvey = Readonly<{
  readonly seed: number
  readonly stride: number
  readonly heights: ReadonlyArray<number>
  readonly lowerBoundaryHits: number
  readonly upperBoundaryHits: number
  readonly belowSea: number
  readonly lowestSurface: Readonly<{ wx: number; wz: number; y: number }>
  readonly sampler: TerrainDensitySampler
}>

const surveySeed = (seedValue: number, stride: number): TerrainSurvey => {
  const sampler = Result.getOrThrow(createTerrainDensitySampler(noiseSeed(seedValue)))
  const heights: Array<number> = []
  const half = SURVEY_SPAN / 2
  let lowerBoundaryHits = 0
  let upperBoundaryHits = 0
  let belowSea = 0
  let lowestSurface = { wx: -half, wz: -half, y: MAX_SURFACE_Y }

  for (let dz = 0; dz < SURVEY_SPAN; dz += stride) {
    for (let dx = 0; dx < SURVEY_SPAN; dx += stride) {
      const wx = dx - half
      const wz = dz - half
      const sample = sampler.surfaceHeightAt(wx, wz)
      if (Result.isFailure(sample)) {
        throw new Error(`surface sample failed for seed ${String(seedValue)} at ${String(wx)},${String(wz)}: ${sample.failure.message}`)
      }
      const surfaceY = sample.success
      heights.push(surfaceY)
      if (surfaceY === MIN_SURFACE_Y) {
        lowerBoundaryHits += 1
      }
      if (surfaceY === MAX_SURFACE_Y) {
        upperBoundaryHits += 1
      }
      if (surfaceY < DEFAULT_TERRAIN_LEVELS.seaLevel) {
        belowSea += 1
      }
      if (surfaceY < lowestSurface.y) {
        lowestSurface = { wx, wz, y: surfaceY }
      }
    }
  }

  return {
    seed: seedValue,
    stride,
    heights: heights.sort((left, right) => left - right),
    lowerBoundaryHits,
    upperBoundaryHits,
    belowSea,
    lowestSurface,
    sampler,
  }
}

const surveys = SURVEY_CONFIGS.map(({ seed, stride }) => surveySeed(seed, stride))

const percentile = (values: ReadonlyArray<number>, fraction: number): number =>
  values[Math.floor((values.length - 1) * fraction)] ?? Number.NaN

const hasVerticalOverhang = (sampler: TerrainDensitySampler): boolean => {
  for (let wx = OVERHANG_GRID_START; wx < OVERHANG_GRID_END; wx += OVERHANG_GRID_STRIDE) {
    for (let wz = OVERHANG_GRID_START; wz < OVERHANG_GRID_END; wz += OVERHANG_GRID_STRIDE) {
      let previousSolid: boolean | undefined
      let signChanges = 0

      for (let wy = OVERHANG_SCAN_MIN_Y; wy <= OVERHANG_SCAN_MAX_Y; wy += OVERHANG_SCAN_STEP) {
        const density = Result.getOrThrow(sampler.densityAt(wx, wy, wz))
        const solid = density > SURFACE_THRESHOLD
        if (previousSolid !== undefined && solid !== previousSolid) {
          signChanges += 1
          if (signChanges >= OVERHANG_SIGN_CHANGE_MINIMUM) {
            return true
          }
        }
        previousSolid = solid
      }
    }
  }
  return false
}

describe('the 3D terrain density distribution', () => {
  it.effect('keeps relief, interior quantiles, and boundary rates across five seeds', () =>
    Effect.sync(() => {
      expect(surveys).toHaveLength(SURVEY_SEEDS.length)
      expect(SURVEY_SPAN / BROAD_RELIEF_WAVELENGTH_BLOCKS).toBeGreaterThanOrEqual(MIN_BROAD_RELIEF_WAVELENGTHS)

      for (const survey of surveys) {
        const heightMin = survey.heights[0] ?? Number.NaN
        const heightMax = survey.heights.at(-1) ?? Number.NaN
        const lowerBoundaryShare = survey.lowerBoundaryHits / survey.heights.length
        const upperBoundaryShare = survey.upperBoundaryHits / survey.heights.length

        expect(survey.heights).toHaveLength((SURVEY_SPAN / survey.stride) ** 2)
        expect(heightMin).toBeGreaterThanOrEqual(MIN_SURFACE_Y)
        expect(heightMax).toBeLessThanOrEqual(MAX_SURFACE_Y)
        expect(heightMax).toBeLessThan(CHUNK_HEIGHT)
        expect(heightMax - heightMin).toBeGreaterThan(MIN_SURFACE_RELIEF)
        expect(percentile(survey.heights, HEIGHT_MEDIAN_FRACTION)).toBeGreaterThan(MEDIAN_SURFACE_MIN)
        expect(percentile(survey.heights, HEIGHT_MEDIAN_FRACTION)).toBeLessThan(MEDIAN_SURFACE_MAX)
        expect(percentile(survey.heights, HEIGHT_P95_FRACTION)).toBeGreaterThan(
          percentile(survey.heights, HEIGHT_MEDIAN_FRACTION),
        )
        expect(lowerBoundaryShare, `lower-bound hits on seed ${String(survey.seed)}`).toBeLessThan(MAX_BOUNDARY_HIT_SHARE)
        expect(upperBoundaryShare, `upper-bound hits on seed ${String(survey.seed)}`).toBeLessThan(MAX_BOUNDARY_HIT_SHARE)
      }
      expect(DEFAULT_TERRAIN_LEVELS.seaLevel).toBe(63)
    }),
  )

  it.effect('keeps a substantial sea-level fraction across five seeds', () =>
    Effect.sync(() => {
      const belowSeaShares = surveys.map((survey) => ({
        seed: survey.seed,
        share: survey.belowSea / survey.heights.length,
      }))
      const outsideRange = belowSeaShares.filter(
        ({ share }) => share <= SEA_LEVEL_MIN_SHARE || share >= SEA_LEVEL_MAX_SHARE,
      )

      expect(outsideRange, `measured below-sea shares: ${JSON.stringify(belowSeaShares)}`).toStrictEqual([])
    }),
  )

  it.effect('contains real 3D vertical overhangs where density alternates between solid and air', () =>
    Effect.sync(() => {
      const firstSurvey = surveys[0]
      if (firstSurvey === undefined) {
        throw new Error('the fixed terrain survey must contain a seed')
      }
      expect(hasVerticalOverhang(firstSurvey.sampler)).toBe(true)
    }),
  )

  it.effect('generates a chunk at the lowest sampled surface using the full column scan range', () =>
    Effect.sync(() => {
      const firstSurvey = surveys[0]
      if (firstSurvey === undefined) {
        throw new Error('the fixed terrain survey must contain a seed')
      }
      expect(firstSurvey.lowestSurface.y).toBeGreaterThanOrEqual(MIN_SURFACE_Y)
      expect(firstSurvey.lowestSurface.y).toBeLessThanOrEqual(MAX_SURFACE_Y)

      const chunk = generateChunkAt(
        noiseSeed(firstSurvey.seed),
        chunkAxis(Math.floor(firstSurvey.lowestSurface.wx / CHUNK_SIZE_XZ)),
        chunkAxis(Math.floor(firstSurvey.lowestSurface.wz / CHUNK_SIZE_XZ)),
        { decorate: false },
      )
      expect(Result.isSuccess(chunk)).toBe(true)
    }),
  )
})
