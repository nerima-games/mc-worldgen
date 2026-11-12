import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, DEFAULT_TERRAIN_LEVELS, LAKE_LEVEL, SEA_LEVEL } from '../src/domain/constants'
import { readBlock } from '../src/domain/chunk'
import { InvalidTerrainLevels, generateChunkAt as generateChunkAtResult } from '../src/domain/terrain'
import { generateChunkAt } from './helpers/unwrapped-worldgen'
import { chunkAxis, noiseSeed } from './fixtures/validated-inputs'

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
        const chunk = generateChunkAt(noiseSeed(1234), chunkAxis(cx), chunkAxis(cz))

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
      const lowered = generateChunkAt(noiseSeed(1234), chunkAxis(0), chunkAxis(0), { terrainLevels: { seaLevel: 20, lakeLevel: 20 } })

      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          for (let y = 21; y < CHUNK_HEIGHT; y += 1) {
            expect(readBlock(lowered.blocks, blockIndex(lx, y, lz))).not.toBe(BLOCK.WATER)
          }
        }
      }
    }),
  )

  it.effect('rejects explicit null terrain levels instead of treating them as omitted', () =>
    Effect.sync(() => {
      // Keep the invalid runtime value unasserted against the valid options type.
      const result = Reflect.apply(generateChunkAtResult, undefined, [
        noiseSeed(1234),
        chunkAxis(0),
        chunkAxis(0),
        { terrainLevels: null },
      ])

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(InvalidTerrainLevels)
        expect(result.failure).toMatchObject({ _tag: 'InvalidTerrainLevels', field: 'terrainLevels' })
      }
    }),
  )

  it.effect('rejects non-positive, non-finite, and fractional water floor margins with a typed failure', () =>
    Effect.sync(() => {
      for (const waterFloorMargin of [
        -1,
        0,
        undefined,
        null,
        '3',
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        1.5,
      ]) {
        const result = Reflect.apply(generateChunkAtResult, undefined, [
          noiseSeed(1234),
          chunkAxis(0),
          chunkAxis(0),
          { carve: { waterFloorMargin } },
        ])

        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(InvalidTerrainLevels)
          expect(result.failure).toMatchObject({ _tag: 'InvalidTerrainLevels', field: 'waterFloorMargin' })
        }
      }
    }),
  )

  it.effect('rejects chunk coordinates whose block origin is outside the safe integer range', () =>
    Effect.sync(() => {
      expect(() =>
        generateChunkAt(noiseSeed(1234), chunkAxis(Number.MAX_SAFE_INTEGER), chunkAxis(0), { decorate: false }),
      ).toThrow()
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
      ].some(([cx, cz]) => generateChunkAt(noiseSeed(1234), chunkAxis(cx ?? 0), chunkAxis(cz ?? 0)).blocks.includes(BLOCK.WATER))

      expect(anyWater).toBe(true)
    }),
  )
})

describe('water floor margin input', () => {
  const generateWithOptions = (options: unknown) =>
    Reflect.apply(generateChunkAtResult, undefined, [noiseSeed(1234), chunkAxis(0), chunkAxis(0), options])

  it.effect('accepts the positive integer boundary', () =>
    Effect.sync(() => {
      const result = generateWithOptions({ carve: { waterFloorMargin: 1 } })

      expect(Result.isSuccess(result)).toBe(true)
    }),
  )

  it.effect('defaults an omitted carve margin, rejects explicit undefined and malformed options', () =>
    Effect.sync(() => {
      const omittedMargin = generateWithOptions({ carve: {} })
      expect(Result.isSuccess(omittedMargin)).toBe(true)

      for (const options of [null]) {
        const result = generateWithOptions(options)
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ _tag: 'InvalidTerrainLevels', field: 'options' })
        }
      }

      const explicitUndefinedCarve = generateWithOptions({ carve: undefined })
      expect(Result.isFailure(explicitUndefinedCarve)).toBe(true)
      if (Result.isFailure(explicitUndefinedCarve)) {
        expect(explicitUndefinedCarve.failure).toMatchObject({ _tag: 'InvalidTerrainLevels', field: 'options' })
      }
    }),
  )

  it.effect('rejects malformed carve values and margin accessors without invoking them', () =>
    Effect.sync(() => {
      const invalidCarveValues = [null, undefined, [], 'invalid carve options', 1]
      for (const carve of invalidCarveValues) {
        const result = generateWithOptions({ carve })
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ _tag: 'InvalidTerrainLevels', field: 'options' })
        }
      }

      const carveAccessor = Object.defineProperty({}, 'carve', {
        configurable: true,
        get: () => {
          throw new Error('carve accessor must not run')
        },
      })
      const carveAccessorResult = generateWithOptions(carveAccessor)
      expect(Result.isFailure(carveAccessorResult)).toBe(true)
      if (Result.isFailure(carveAccessorResult)) {
        expect(carveAccessorResult.failure).toMatchObject({ field: 'options' })
      }

      const marginAccessor = Object.defineProperty({}, 'waterFloorMargin', {
        configurable: true,
        get: () => {
          throw new Error('waterFloorMargin accessor must not run')
        },
      })
      const marginAccessorResult = generateWithOptions({ carve: marginAccessor })
      expect(Result.isFailure(marginAccessorResult)).toBe(true)
      if (Result.isFailure(marginAccessorResult)) {
        expect(marginAccessorResult.failure).toMatchObject({ field: 'waterFloorMargin' })
      }
    }),
  )
})
