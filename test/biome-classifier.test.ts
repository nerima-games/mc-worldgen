/* oxlint-disable no-magic-numbers */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

// eslint-disable-next-line sort-imports -- The external imports precede the project module.
import {
  type ClimateSample,
  classifyBiomeFromClimate,
  peaksAndValleysFromWeirdness,
  refineBeachBiome,
} from '../src/domain/biome-classifier'

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
