/**
 * Deterministic seeding.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * This module is a placeholder for mc-noise
 * ---------------------------------------------------------------------------
 *
 * plan.md §2.1 puts noise in `@nerima-games/mc-noise`, and mc-worldgen depends
 * on it. Nothing is published yet (plan.md §6 Step 0 defers publishing), so
 * this repository carries the minimum it needs to be deterministic on its own:
 * a seeded PRNG and a value-noise field. When mc-noise is consumable, everything
 * here is deleted and `sampleField` is replaced by a call into it.
 *
 * What must survive that swap is the *property*, not the numbers: chunk output
 * is a total function of `(seed, coords)`. `test/determinism.test.ts` is written
 * against `generateChunk`, not against this module, so it keeps working.
 *
 * ---------------------------------------------------------------------------
 * The trap this module is shaped to avoid
 * ---------------------------------------------------------------------------
 *
 * The reference implementation's Perlin builder took an OPTIONAL random source
 * and fell back to the global one — `packages/world/domain/perlin.ts:42`:
 *
 *     const perm = buildPerm(rand ?? Math.random)
 *
 * A single caller forgetting the argument would have produced terrain that
 * differed on every load, with no type error and no crash. The generation path
 * happened never to trip it, and a dedicated test existed to keep it that way
 * (`packages/world/test/terrain-determinism.test.ts:10-12`) — but the fallback
 * remained one missing argument away from a save-corrupting bug.
 *
 * Here the seed is required. There is no fallback to remove later.
 */

/**
 * mulberry32: a small, fast, well-distributed 32-bit PRNG.
 *
 * Reference: `packages/world/domain/noise-primitives.ts:15`. Chosen for the
 * same reason it was chosen there — it needs no BigInt, has a full 2³² period,
 * and is trivially reproducible across JS engines, which matters because a
 * world seed has to mean the same thing in a browser, in a worker and in Node.
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

/**
 * Derive an independent sub-seed for a named channel.
 *
 * The reference decorrelated its channels by XOR-ing distinct Weyl constants
 * into the world seed before building each generator
 * (`noise-primitives.ts:235-245`). Same idea, keyed by a string so that adding a
 * channel does not require inventing and documenting another magic number.
 *
 * Channels must be decorrelated or terrain features line up: if temperature and
 * humidity share a generator, every hot region is also wet and half the biome
 * table becomes unreachable.
 */
export const channelSeed = (seed: number, channel: string): number => {
  let hash = seed >>> 0
  for (let index = 0; index < channel.length; index += 1) {
    hash = Math.imul(hash ^ channel.charCodeAt(index), 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * A deterministic value in [0, 1) for an integer lattice point.
 *
 * Position-absolute rather than chunk-relative, which is what makes chunk
 * boundaries seamless: neighbouring chunks sampling the same world coordinate
 * get the same value, so no seam appears at x = 16. The reference relies on the
 * same property (`terrain/generator.ts:39-40` converts to absolute world
 * coordinates before sampling).
 */
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

/**
 * Smoothly interpolated value noise in [0, 1].
 *
 * A stand-in for mc-noise's Perlin/simplex, adequate for a skeleton because it
 * has the two properties the rest of the pipeline actually depends on:
 * determinism, and continuity across chunk boundaries.
 */
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

/**
 * Fractal Brownian motion: octaves of `valueNoise2D` at doubling frequency and
 * halving amplitude.
 *
 * NOTE the `let` + `for` loop. plan.md §5.2 lists the noise octave loop as a
 * measured performance exception that must NOT be "fixed" into an array fold —
 * the state thread is deliberate. It is written that way here so the convention
 * is established before mc-noise inherits it.
 *
 * A convention held up by a comment is one refactor from being lost, so it is
 * also measured: `scripts/bench-terrain.ts` (run with `pnpm bench`) pins this
 * function against a frozen copy of its own current shape, and prices the fold
 * at 4.1x. Rewriting it as `Array.from().reduce` makes `generateChunk` 1.93x
 * slower overall — this one loop is roughly 44% of chunk generation. See
 * docs/testing.md §7.
 */
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
