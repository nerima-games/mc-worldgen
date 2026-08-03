/**
 * Deterministic terrain-noise compatibility primitives.
 *
 * This module remains the worldgen boundary until the value-noise API from
 * mc-noise value-noise API is published. Its output is part of the existing terrain golden
 * contract and must not change as a side effect of dependency maintenance.
 */

export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export const channelSeed = (seed: number, channel: string): number => {
  let hash = seed >>> 0
  for (let index = 0; index < channel.length; index += 1) {
    hash = Math.imul(hash ^ channel.charCodeAt(index), 0x01000193) >>> 0
  }
  return hash >>> 0
}

export const latticeValue = (seed: number, x: number, z: number): number => {
  let hash = seed >>> 0
  hash = Math.imul(hash ^ (x >>> 0), 0x85ebca6b) >>> 0
  hash = Math.imul(hash ^ (z >>> 0), 0xc2b2ae35) >>> 0
  hash = Math.imul(hash ^ (x >>> 16), 0x27d4eb2f) >>> 0
  hash ^= hash >>> 15
  return (hash >>> 0) / 4294967296
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const valueNoise2D = (seed: number, x: number, z: number, frequency: number): number => {
  const sx = x * frequency
  const sz = z * frequency
  const x0 = Math.floor(sx)
  const z0 = Math.floor(sz)
  const tx = smoothstep(sx - x0)
  const tz = smoothstep(sz - z0)
  const top = lerp(latticeValue(seed, x0, z0), latticeValue(seed, x0 + 1, z0), tx)
  const bottom = lerp(latticeValue(seed, x0, z0 + 1), latticeValue(seed, x0 + 1, z0 + 1), tx)
  return lerp(top, bottom, tz)
}

export const fbm2D = (
  seed: number,
  x: number,
  z: number,
  options: { readonly octaves: number; readonly frequency: number; readonly persistence: number },
): number => {
  let total = 0
  let amplitude = 1
  let frequency = options.frequency
  let normalisation = 0
  for (let octave = 0; octave < options.octaves; octave += 1) {
    total += valueNoise2D(channelSeed(seed, `octave-${String(octave)}`), x, z, frequency) * amplitude
    normalisation += amplitude
    amplitude *= options.persistence
    frequency *= 2
  }
  return normalisation === 0 ? 0 : total / normalisation
}
