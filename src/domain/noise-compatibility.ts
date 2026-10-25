import {
  LatticeCoordinate,
  NoiseChannelLabel,
  NoiseFrequency,
  type NoiseSeed,
  OctaveAmplitude,
  OctaveCount,
  channelSeed as deriveChannelSeed,
  fbm2D as sampleFbm2D,
  latticeValue as sampleLatticeValue,
  valueNoise2D as sampleValueNoise2D,
} from '@nerima-games/mc-noise'
import { Result } from 'effect'

export type { NoiseSeed } from '@nerima-games/mc-noise'

export const channelSeed = (seed: NoiseSeed, channel: string): NoiseSeed =>
  deriveChannelSeed(seed, Result.getOrThrow(NoiseChannelLabel.result(channel)))

export const latticeValue = (seed: NoiseSeed, x: number, z: number): number =>
  sampleLatticeValue(
    seed,
    Result.getOrThrow(LatticeCoordinate.result(x)),
    Result.getOrThrow(LatticeCoordinate.result(z)),
  )

export const valueNoise2D = (seed: NoiseSeed, x: number, z: number, frequency: number): number =>
  Result.getOrThrow(
    sampleValueNoise2D(seed, x, z, Result.getOrThrow(NoiseFrequency.result(frequency))),
  )

export const fbm2D = (
  seed: NoiseSeed,
  x: number,
  z: number,
  options: Readonly<{ frequency: number; octaves: number; persistence: number }>,
): number =>
  Result.getOrThrow(
    sampleFbm2D(seed, x, z, {
      frequency: Result.getOrThrow(NoiseFrequency.result(options.frequency)),
      octaves: Result.getOrThrow(OctaveCount.result(options.octaves)),
      persistence: Result.getOrThrow(OctaveAmplitude.result(options.persistence)),
    }),
  )
