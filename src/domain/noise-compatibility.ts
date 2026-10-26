import { Brand } from 'effect'
import type { NoiseSeed } from '@nerima-games/mc-noise'

export type { NoiseSeed } from '@nerima-games/mc-noise'

const UINT32_COERCION_SHIFT = 0
const FNV_PRIME_32 = 0x01000193
const LATTICE_MIX_X = 0x85ebca6b
const LATTICE_MIX_Z = 0xc2b2ae35
const LATTICE_MIX_X_HIGH = 0x27d4eb2f
const HIGH_HALF_SHIFT = 16
const FINAL_MIX_SHIFT = 15
const UINT32_MODULUS = 4294967296
const LOOP_STEP = 1
const LATTICE_NEIGHBOR_OFFSET = 1
const INITIAL_AMPLITUDE = 1
const FREQUENCY_MULTIPLIER = 2
const ZERO_NORMALISATION = 0
const SMOOTHSTEP_QUADRATIC_COEFFICIENT = 3
const SMOOTHSTEP_CUBIC_COEFFICIENT = 2

const asUint32 = (value: number): number => value >>> UINT32_COERCION_SHIFT
const noiseSeedFromUint32 = Brand.nominal<NoiseSeed>()
const latticeValueAt = (seed: number, x: number, z: number): number => {
  let hash = asUint32(seed)
  hash = asUint32(Math.imul(hash ^ asUint32(x), LATTICE_MIX_X))
  hash = asUint32(Math.imul(hash ^ asUint32(z), LATTICE_MIX_Z))
  hash = asUint32(Math.imul(hash ^ (x >>> HIGH_HALF_SHIFT), LATTICE_MIX_X_HIGH))
  hash ^= hash >>> FINAL_MIX_SHIFT
  return asUint32(hash) / UINT32_MODULUS
}

const smoothstep = (amount: number): number =>
  amount * amount * (SMOOTHSTEP_QUADRATIC_COEFFICIENT - SMOOTHSTEP_CUBIC_COEFFICIENT * amount)

const lerp = (start: number, end: number, amount: number): number => start + (end - start) * amount

const sampleValueNoise2D = (seed: number, x: number, z: number, frequency: number): number => {
  const sx = x * frequency
  const sz = z * frequency
  const x0 = Math.floor(sx)
  const z0 = Math.floor(sz)
  const tx = smoothstep(sx - x0)
  const tz = smoothstep(sz - z0)
  const top = lerp(latticeValueAt(seed, x0, z0), latticeValueAt(seed, x0 + LATTICE_NEIGHBOR_OFFSET, z0), tx)
  const bottom = lerp(latticeValueAt(seed, x0, z0 + LATTICE_NEIGHBOR_OFFSET), latticeValueAt(seed, x0 + LATTICE_NEIGHBOR_OFFSET, z0 + LATTICE_NEIGHBOR_OFFSET), tx)
  return lerp(top, bottom, tz)
}

export const channelSeedValue = (seed: number, channel: string): number => {
  let hash = asUint32(seed)
  for (let index = 0; index < channel.length; index += LOOP_STEP) {
    hash = asUint32(Math.imul(hash ^ channel.charCodeAt(index), FNV_PRIME_32))
  }
  return asUint32(hash)
}

export const channelSeed = (seed: NoiseSeed, channel: string): NoiseSeed =>
  noiseSeedFromUint32(channelSeedValue(seed, channel))

export const latticeValue = (seed: number, x: number, z: number): number => latticeValueAt(seed, x, z)

export const valueNoise2D = (seed: number, x: number, z: number, frequency: number): number =>
  sampleValueNoise2D(seed, x, z, frequency)

const normaliseFbmSample = (total: number, normalisation: number): number => {
  if (normalisation === ZERO_NORMALISATION) {
    return ZERO_NORMALISATION
  }
  return total / normalisation
}

export const fbm2D = (
  seed: number,
  x: number,
  z: number,
  options: Readonly<{ frequency: number; octaves: number; persistence: number }>,
): number => {
  let total = ZERO_NORMALISATION
  let amplitude = INITIAL_AMPLITUDE
  let normalisation = ZERO_NORMALISATION
  let { frequency } = options

  for (let octave = ZERO_NORMALISATION; octave < options.octaves; octave += LOOP_STEP) {
    total +=
      sampleValueNoise2D(channelSeedValue(seed, `octave-${String(octave)}`), x, z, frequency) * amplitude
    normalisation += amplitude
    amplitude *= options.persistence
    frequency *= FREQUENCY_MULTIPLIER
  }

  return normaliseFbmSample(total, normalisation)
}
