import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, DEFAULT_TERRAIN_LEVELS, LAKE_LEVEL, SEA_LEVEL } from '../src/domain/constants'
import { readBlock } from '../src/domain/chunk'
import { generateChunkAt } from '../src/domain/terrain'

/**
 * ---------------------------------------------------------------------------
 * The plan.md §3.7 correction, pinned.
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.7 lists, under 設計注意(参照実装の実測知見) — the section whose
 * items it instructs should become regression tests:
 *
 *     地形定数: `SEA_LEVEL=48`、`LAKE_LEVEL=62`
 *
 * Both numbers are wrong. `packages/core/domain/constants.ts` says:
 *
 *     :17  export const SEA_LEVEL = 63
 *     :20  export const LAKE_LEVEL = SEA_LEVEL
 *
 * These tests exist so that the correct values cannot be quietly "fixed" back
 * to plan.md's, which is exactly what a diligent reader of plan.md would do.
 */

describe('SEA_LEVEL and LAKE_LEVEL', () => {
  it.effect('SEA_LEVEL is 63 — NOT the 48 that plan.md §3.7 states', () =>
    Effect.sync(() => {
      expect(SEA_LEVEL).toBe(63)
      expect(SEA_LEVEL).not.toBe(48)
    }),
  )

  it.effect('LAKE_LEVEL equals SEA_LEVEL — it is NOT a distinct constant, and NOT 62', () =>
    Effect.sync(() => {
      // The reference defines LAKE_LEVEL as SEA_LEVEL, not as a separate number.
      // There is no one-block offset between a lake surface and a sea surface,
      // and code that branches on the difference encodes a distinction that has
      // never existed in the reference implementation.
      expect(LAKE_LEVEL).toBe(SEA_LEVEL)
      expect(LAKE_LEVEL).toBe(63)
      expect(LAKE_LEVEL).not.toBe(62)
    }),
  )

  it.effect('DEFAULT_TERRAIN_LEVELS carries both, so generation can be reconfigured without editing code', () =>
    Effect.sync(() => {
      expect(DEFAULT_TERRAIN_LEVELS).toStrictEqual({ seaLevel: 63, lakeLevel: 63 })
    }),
  )
})

/**
 * The invariant the constants exist to serve, ported from
 * `packages/world/test/terrain-water-level-invariant.test.ts:28`
 * ("never generates water above LAKE_LEVEL"). A whole-chunk sweep rather than a
 * spot check, because the failure is a single floating block somewhere.
 */
describe('water level invariant', () => {
  const COORDS = [
    [0, 0],
    [4, -3],
    [-9, 12],
  ] as const

  it.effect('never places water above LAKE_LEVEL, anywhere, in any chunk', () =>
    Effect.sync(() => {
      for (const [cx, cz] of COORDS) {
        const chunk = generateChunkAt(1234, cx, cz)

        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            for (let y = LAKE_LEVEL + 1; y < CHUNK_HEIGHT; y += 1) {
              expect(readBlock(chunk.blocks, blockIndex(lx, y, lz))).not.toBe(BLOCK.WATER)
            }
          }
        }
      }
    }),
  )

  it.effect('honours a caller-supplied sea level rather than the baked constant', () =>
    Effect.sync(() => {
      // The levels are injected, exactly as the reference threads
      // `terrainLevels: TerrainLevels = DEFAULT_TERRAIN_LEVELS` through its
      // pipeline (`terrain/generator.ts:34`). A superflat or exaggerated-sea
      // preview must not require editing generation code.
      const lowered = generateChunkAt(1234, 0, 0, { terrainLevels: { seaLevel: 20, lakeLevel: 20 } })

      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          for (let y = 21; y < CHUNK_HEIGHT; y += 1) {
            expect(readBlock(lowered.blocks, blockIndex(lx, y, lz))).not.toBe(BLOCK.WATER)
          }
        }
      }
    }),
  )

  it.effect('does put water somewhere, so the sweep above is not vacuously true', () =>
    Effect.sync(() => {
      const anyWater = [
        [0, 0],
        [4, -3],
        [-9, 12],
        [20, 20],
        [-30, 7],
      ].some(([cx, cz]) => generateChunkAt(1234, cx ?? 0, cz ?? 0).blocks.includes(BLOCK.WATER))

      expect(anyWater).toBe(true)
    }),
  )
})
