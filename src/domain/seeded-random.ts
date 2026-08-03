/**
 * Compatibility boundary for the deterministic noise package.
 *
 * Worldgen keeps this local import path so terrain modules do not know the
 * package boundary. The implementation and seed-to-value contract belong to
 * mc-noise.
 */
import {
  NoiseSeed,
  channelSeed,
  fbm2D,
  latticeValue,
  mulberry32 as noiseMulberry32,
  valueNoise2D,
} from '@nerima-games/mc-noise'

export { channelSeed, fbm2D, latticeValue, valueNoise2D }

export const mulberry32 = (seed: number): (() => number) =>
  noiseMulberry32(NoiseSeed(seed))
