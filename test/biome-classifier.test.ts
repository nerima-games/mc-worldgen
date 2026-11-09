/* oxlint-disable no-magic-numbers */
import * as fc from 'fast-check'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'

// eslint-disable-next-line sort-imports -- The external imports precede the project module.
import {
  type ClimateSample,
  classifyBiomeFromClimate,
  refineBiomeCategoryForKernel,
  peaksAndValleysFromWeirdness,
  refineBeachBiome,
} from '../src/domain/biome-classifier'
import { BIOMES, KERNEL_BIOMES } from '../src/domain/biome'
import { blockAxis } from './fixtures/validated-inputs'

const climate = (overrides: Partial<ClimateSample> = {}): ClimateSample => ({
  continentalness: 0,
  erosion: 0.5,
  humidity: 0.5,
  pv: 0,
  riverNoise: 0.1,
  temperature: 0.5,
  ...overrides,
})

describe('biome classifier', () => {
  it.effect('converts weirdness to peaks and valleys', () =>
    Effect.sync(() => {
      expect(peaksAndValleysFromWeirdness(0)).toBe(-1)
      expect(peaksAndValleysFromWeirdness(2 / 3)).toBe(1)
      expect(peaksAndValleysFromWeirdness(-2 / 3)).toBe(1)
    }),
  )

  it.effect('prioritizes rivers inside the continental river band', () =>
    Effect.sync(() => {
      expect(
        classifyBiomeFromClimate(
          climate({ continentalness: 0, riverNoise: 0.5 }),
        ),
      ).toBe('RIVER')
    }),
  )

  it.effect('classifies deep continentalness as ocean', () =>
    Effect.sync(() => {
      expect(
        classifyBiomeFromClimate(
          climate({ continentalness: -0.5, riverNoise: 0.1 }),
        ),
      ).toBe('OCEAN')
    }),
  )

  it.effect('raises high peaks to snow or mountains', () =>
    Effect.sync(() => {
      const coldHighland = climate({
        continentalness: 0.5,
        erosion: 0.1,
        humidity: 0.5,
        pv: 0.8,
        temperature: 0.2,
      })
      expect(classifyBiomeFromClimate(coldHighland)).toBe('SNOW')
      expect(
        classifyBiomeFromClimate({ ...coldHighland, temperature: 0.5 }),
      ).toBe('MOUNTAINS')
    }),
  )

  it.effect('refines wet forests into flower forests on noisy rivers', () =>
    Effect.sync(() => {
      expect(
        classifyBiomeFromClimate(
          climate({
            continentalness: 0.5,
            humidity: 0.7,
            riverNoise: 0.9,
          }),
        ),
      ).toBe('FLOWER_FOREST')
    }),
  )

  it.effect('refines every mc-noise category to a registered kernel biome', () =>
    Effect.sync(() => {
      for (const category of BIOMES) {
        const result = refineBiomeCategoryForKernel(category, climate(), blockAxis(100))
        expect(Result.isSuccess(result), `${category} should be supported`).toBe(true)
        if (Result.isSuccess(result)) {
          expect(KERNEL_BIOMES).toContain(result.success)
        }
      }
    }),
  )

  it.effect('refines mountain categories to concrete height and climate variants', () =>
    Effect.sync(() => {
      const cases: ReadonlyArray<readonly [ClimateSample, number, string]> = [
        [climate({ temperature: 0.2 }), 190, 'frozen_peaks'],
        [climate({ temperature: 0.2 }), 160, 'snowy_slopes'],
        [climate({ erosion: 0.2 }), 160, 'windswept_gravelly_hills'],
        [climate({ erosion: 0.8 }), 160, 'stony_peaks'],
        [climate({ humidity: 0.8, temperature: 0.8 }), 130, 'cherry_grove'],
        [climate({ humidity: 0.6 }), 130, 'windswept_forest'],
        [climate({ temperature: 0.2 }), 130, 'grove'],
        [climate(), 130, 'windswept_hills'],
      ]

      for (const [sample, surfaceY, expected] of cases) {
        const result = refineBiomeCategoryForKernel('MOUNTAINS', sample, blockAxis(surfaceY))
        expect(Result.isSuccess(result)).toBe(true)
        if (Result.isSuccess(result)) {
          expect(result.success).toBe(expected)
          expect(KERNEL_BIOMES).toContain(result.success)
        }
      }
    }),
  )

  it.effect('fails with a tagged error for unknown runtime classifier values', () =>
    Effect.sync(() => {
      const result = refineBiomeCategoryForKernel('UNRECOGNIZED_CATEGORY', climate(), blockAxis(80))

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: 'UnsupportedBiomeCategory',
          category: 'UNRECOGNIZED_CATEGORY',
          receivedType: 'string',
        })
      }
    }),
  )

  it.effect('returns a registered biome or a tagged failure for arbitrary runtime categories and climates', () =>
    Effect.sync(() => {
      const categories = new Set<string>(BIOMES)
      fc.assert(
        fc.property(
          fc.anything(),
          fc.record({
            continentalness: fc.integer({ min: -1000, max: 1000 }),
            erosion: fc.integer({ min: -1000, max: 1000 }),
            humidity: fc.integer({ min: -1000, max: 1000 }),
            pv: fc.integer({ min: -1000, max: 1000 }),
            riverNoise: fc.integer({ min: -1000, max: 1000 }),
            temperature: fc.integer({ min: -1000, max: 1000 }),
          }),
          fc.integer({ min: -64, max: 511 }),
          (category, climateSample, surfaceY) => {
            const result = refineBiomeCategoryForKernel(category, climateSample, blockAxis(surfaceY))
            if (typeof category === 'string' && categories.has(category)) {
              expect(Result.isSuccess(result)).toBe(true)
              if (Result.isSuccess(result)) {
                expect(KERNEL_BIOMES).toContain(result.success)
              }
              return
            }

            expect(Result.isFailure(result)).toBe(true)
            if (Result.isFailure(result)) {
              expect(result.failure._tag).toBe('UnsupportedBiomeCategory')
            }
          },
        ),
        { numRuns: 128, seed: 0x71e29 },
      )
    }),
  )
})

describe('beach refinement', () => {
  it.effect('adds a beach only beside an ocean on low continentalness', () =>
    Effect.sync(() => {
      expect(refineBeachBiome('PLAINS', ['OCEAN'], 0.1)).toBe('BEACH')
      expect(refineBeachBiome('PLAINS', ['OCEAN'], 0.2)).toBe('PLAINS')
      expect(refineBeachBiome('PLAINS', ['FOREST'], 0.1)).toBe('PLAINS')
    }),
  )

  it.effect('does not overwrite excluded biomes', () =>
    Effect.sync(() => {
      expect(refineBeachBiome('OCEAN', ['OCEAN'], 0.1)).toBe('OCEAN')
      expect(refineBeachBiome('DESERT', ['OCEAN'], 0.1)).toBe('DESERT')
      expect(refineBeachBiome('SWAMP', ['OCEAN'], 0.1)).toBe('SWAMP')
    }),
  )
})
