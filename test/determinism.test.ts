import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { chunkCoord } from '@nerima-games/mc-kernel'
import { CHUNK_VOLUME } from '../src/domain/constants'
import { generateChunk, generateChunkAt, surfaceHeightAt } from '../src/domain/terrain'

/**
 * ---------------------------------------------------------------------------
 * The property everything else rests on.
 * ---------------------------------------------------------------------------
 *
 * A save file stores a seed, not the terrain. If generation drifts — between
 * builds, between machines, between a worker and the main thread — every
 * existing world is retroactively corrupted, and the symptom is a seam or a
 * hole rather than an error message.
 *
 * The reference implementation has the same test
 * (`packages/world/test/terrain-determinism.test.ts`) and it earns its keep: it
 * is what kept the unseeded `Math.random` fallback at
 * `packages/world/domain/perlin.ts:42` from ever being reached. This repository
 * uses the direct `mc-noise` sampler instead, but the test still belongs here,
 * because the next way to lose determinism will be a different one.
 */

const SEED = 1337

describe('generateChunk is deterministic', () => {
  it.effect('produces byte-identical blocks for the same seed and coordinate', () =>
    Effect.sync(() => {
      const first = generateChunk(SEED, chunkCoord(3, -7))
      const second = generateChunk(SEED, chunkCoord(3, -7))

      expect(first.blocks).toStrictEqual(second.blocks)
      expect(first.biomes).toStrictEqual(second.biomes)
      expect(first.blocks.length).toBe(CHUNK_VOLUME)
    }),
  )

  it.effect('does not depend on the order chunks are generated in', () =>
    Effect.sync(() => {
      const ascending = [chunkCoord(0, 0), chunkCoord(1, 0), chunkCoord(2, 0)].map((coord) =>
        generateChunk(SEED, coord),
      )
      const descending = [chunkCoord(2, 0), chunkCoord(1, 0), chunkCoord(0, 0)].map((coord) =>
        generateChunk(SEED, coord),
      )

      expect(ascending[0]?.blocks).toStrictEqual(descending[2]?.blocks)
      expect(ascending[1]?.blocks).toStrictEqual(descending[1]?.blocks)
      expect(ascending[2]?.blocks).toStrictEqual(descending[0]?.blocks)
    }),
  )

  it.effect('gives different seeds different worlds', () =>
    Effect.sync(() => {
      const alpha = generateChunk(1, chunkCoord(0, 0))
      const beta = generateChunk(2, chunkCoord(0, 0))

      expect(alpha.blocks).not.toStrictEqual(beta.blocks)
    }),
  )

  it.effect('gives different coordinates different terrain under one seed', () =>
    Effect.sync(() => {
      const here = generateChunk(SEED, chunkCoord(0, 0))
      const faraway = generateChunk(SEED, chunkCoord(64, 64))

      expect(here.blocks).not.toStrictEqual(faraway.blocks)
    }),
  )

  it.effect('handles negative coordinates, where floor-vs-truncate bugs live', () =>
    Effect.sync(() => {
      // -1 / 16 truncates towards zero in JavaScript while flooring goes to -1.
      // A generator that mixes the two produces a visible discontinuity at the
      // origin and nowhere else, which is why this is worth its own case.
      const negative = generateChunk(SEED, chunkCoord(-1, -1))
      const again = generateChunk(SEED, chunkCoord(-1, -1))

      expect(negative.blocks).toStrictEqual(again.blocks)
      expect(negative.blocks).not.toStrictEqual(generateChunk(SEED, chunkCoord(0, 0)).blocks)
    }),
  )
})

describe('sampling is position-absolute, so chunk borders are seamless', () => {
  /**
   * The seam test. Column x = 15 of chunk 0 and column x = 0 of chunk 1 are
   * adjacent world columns; if the generator sampled chunk-relative coordinates
   * they would get unrelated heights and a cliff would appear at every multiple
   * of 16.
   */
  it.effect('agrees about the surface height of a column shared by two chunks', () =>
    Effect.sync(() => {
      for (let lz = 0; lz < 16; lz += 1) {
        const leftEdge = surfaceHeightAt(SEED, 15, lz)
        const rightEdge = surfaceHeightAt(SEED, 16, lz)

        // Adjacent columns need not be equal, but they must be close: the noise
        // is continuous, so a one-block step is normal and a chasm is a bug.
        expect(Math.abs(leftEdge - rightEdge)).toBeLessThanOrEqual(2)
      }
    }),
  )

  it.effect('surfaceHeightAt agrees with what generateChunk actually built', () =>
    Effect.sync(() => {
      // The cheap query and the real pipeline must not diverge — the chunk
      // manager uses the former for spawn selection without generating a chunk.
      const chunk = generateChunkAt(SEED, 5, 5, { decorate: false })

      for (let lx = 0; lx < 16; lx += 4) {
        for (let lz = 0; lz < 16; lz += 4) {
          const expected = surfaceHeightAt(SEED, 5 * 16 + lx, 5 * 16 + lz)
          expect(expected).toBeGreaterThan(0)
          // The surface block itself is solid in the generated buffer.
          expect(chunk.blocks[expected + lz * 256 + lx * 256 * 16]).not.toBe(0)
        }
      }
    }),
  )
})
