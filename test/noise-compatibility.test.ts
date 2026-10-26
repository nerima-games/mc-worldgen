import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { channelSeedValue, fbm2D, valueNoise2D } from '../src/domain/noise-compatibility'

describe('fbm2D normalization', () => {
  it.effect('returns zero for no octaves and the sample for one octave', () =>
    Effect.sync(() => {
      const seed = 1234
      const coordinates = { x: 17, z: -29 }
      const frequency = 0.125
      expect(fbm2D(seed, coordinates.x, coordinates.z, { frequency, octaves: 0, persistence: 0.5 })).toBe(0)
      expect(fbm2D(seed, coordinates.x, coordinates.z, { frequency, octaves: 1, persistence: 0.5 })).toBe(
        valueNoise2D(channelSeedValue(seed, 'octave-0'), coordinates.x, coordinates.z, frequency),
      )
    }),
  )
})
