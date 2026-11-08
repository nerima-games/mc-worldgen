import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import { Effect, Result, Schema } from 'effect'
import { CHUNK_FORMAT, InvalidTerrainLevels, generateChunk, generateChunkAt } from '../src/index'
import { chunkAxis, noiseSeed } from './fixtures/validated-inputs'

const SEED = noiseSeed(1234)
const X = chunkAxis(0)
const Z = chunkAxis(0)
const arbitraryBoundedLevels = fc.record({
  lakeLevel: fc.integer({ min: 0, max: 128 }),
  seaLevel: fc.integer({ min: 0, max: 128 }),
})

const arbitraryOptions = fc.oneof(
  fc.anything().map((terrainLevels) => ({ terrainLevels })),
  arbitraryBoundedLevels.map((terrainLevels) => ({ terrainLevels })),
  fc.constant(null),
  fc.constant('invalid options'),
  fc.constant(123),
  fc.constant([]),
  fc.constant(undefined),
  fc.constant({ terrainLevels: null }),
  fc.constant({}),
  fc.constant({ terrainLevels: undefined }),
)

const generateAtLevels = (terrainLevels: unknown): unknown =>
  Reflect.apply(generateChunkAt, undefined, [SEED, X, Z, { terrainLevels }])

const generateWithOptions = (options: unknown): unknown =>
  Reflect.apply(generateChunkAt, undefined, [SEED, X, Z, options])

const generateChunkWithOptions = (options: unknown): unknown =>
  Reflect.apply(generateChunk, undefined, [SEED, { cx: X, cz: Z }, options])

const expectTypedFailure = (result: unknown): void => {
  expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'InvalidTerrainLevels' } })
  if (typeof result === 'object' && result !== null && '_tag' in result && result._tag === 'Failure' && 'failure' in result) {
    expect(result.failure).toBeInstanceOf(InvalidTerrainLevels)
  }
}

const expectGeneratedChunk = (result: unknown): void => {
  if (typeof result !== 'object' || result === null || !('_tag' in result)) {
    throw new Error('expected generateChunkAt to return a Result')
  }
  if (result._tag === 'Failure') {
    expectTypedFailure(result)
    return
  }
  if (result._tag === 'Success' && 'success' in result) {
    const encoded = Schema.encodeUnknownResult(CHUNK_FORMAT.schema)(result.success)
    expect(Result.isSuccess(encoded)).toBe(true)
    if (!Result.isSuccess(encoded)) {
      return
    }
    const decoded = Schema.decodeUnknownResult(CHUNK_FORMAT.schema)(encoded.success)
    expect(Result.isSuccess(decoded)).toBe(true)
    return
  }
  throw new Error('expected generateChunkAt to return a Result')
}

describe('terrainLevels generation input', () => {
  it.effect('returns a typed failure or a chunk accepted by the exported schema for arbitrary runtime values', () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(arbitraryOptions, (options) => {
          let result: unknown = undefined
          expect(() => {
            result = generateWithOptions(options)
          }).not.toThrow()
          expect(result).not.toBeUndefined()
          expectGeneratedChunk(result)
        }),
        { numRuns: 24, seed: 0x71e22 },
      )
    }),
  )

  it.effect('generateChunk returns a typed failure or schema-valid chunk for arbitrary runtime options', () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(arbitraryOptions, (options) => {
          let result: unknown = undefined
          expect(() => {
            result = generateChunkWithOptions(options)
          }).not.toThrow()
          expect(result).not.toBeUndefined()
          expectGeneratedChunk(result)
        }),
        { numRuns: 24, seed: 0x71e23 },
      )
    }),
  )

  it.effect('accepts the legal BlockAxis limits and rejects the adjacent out-of-range values', () =>
    Effect.sync(() => {
      const legalBoundaryResult = generateAtLevels({
        lakeLevel: Number.MAX_SAFE_INTEGER,
        seaLevel: Number.MIN_SAFE_INTEGER,
      })
      expect(legalBoundaryResult).toMatchObject({ _tag: 'Success' })
      expectGeneratedChunk(legalBoundaryResult)

      for (const terrainLevels of [
        { lakeLevel: Number.MAX_SAFE_INTEGER + 1, seaLevel: 63 },
        { lakeLevel: 63, seaLevel: Number.MIN_SAFE_INTEGER - 1 },
        { lakeLevel: 63 },
        { lakeLevel: 63, seaLevel: '63' },
        { lakeLevel: 63, seaLevel: Number.POSITIVE_INFINITY },
        { lakeLevel: 63, seaLevel: Number.NEGATIVE_INFINITY },
        63,
        [],
        Number.NaN,
        null,
      ]) {
        const result = generateAtLevels(terrainLevels)
        expectTypedFailure(result)
        expect(result).toMatchObject({ failure: { field: 'terrainLevels' } })
      }

      const invalidOptions: ReadonlyArray<{ readonly options: unknown; readonly field: 'options' | 'terrainLevels' }> = [
        { options: null, field: 'options' },
        { options: 'invalid options', field: 'options' },
        { options: [], field: 'options' },
        { options: 123, field: 'options' },
        { options: { terrainLevels: null }, field: 'terrainLevels' },
      ]
      for (const { options, field } of invalidOptions) {
        const result = generateWithOptions(options)
        expectTypedFailure(result)
        expect(result).toMatchObject({ failure: { field } })
      }

      const accessorOptions = Object.defineProperty({}, 'terrainLevels', {
        configurable: true,
        get: () => {
          throw new Error('terrainLevels accessor must not run')
        },
      })
      const accessorResult = generateWithOptions(accessorOptions)
      expectTypedFailure(accessorResult)
      expect(accessorResult).toMatchObject({ failure: { field: 'terrainLevels' } })

      let descriptorReads = 0
      const disappearingDescriptor = new Proxy({}, {
        getOwnPropertyDescriptor: (_target, property) => {
          if (property !== 'terrainLevels') {
            return undefined
          }
          descriptorReads += 1
          return descriptorReads === 1
            ? { configurable: true, enumerable: true, value: undefined, writable: true }
            : undefined
        },
      })
      const missingDescriptorResult = generateWithOptions(disappearingDescriptor)
      expectTypedFailure(missingDescriptorResult)
      expect(missingDescriptorResult).toMatchObject({ failure: { field: 'terrainLevels' } })
      expect(descriptorReads).toBe(2)

      const directGenerateFailure = generateChunkWithOptions({ terrainLevels: null })
      expectTypedFailure(directGenerateFailure)
      expect(directGenerateFailure).toMatchObject({ failure: { field: 'terrainLevels' } })

      const omittedOptions = Reflect.apply(generateChunkAt, undefined, [SEED, X, Z])
      const undefinedOptions = Reflect.apply(generateChunkAt, undefined, [SEED, X, Z, undefined])
      expect(omittedOptions).toMatchObject({ _tag: 'Success' })
      expectGeneratedChunk(omittedOptions)
      expect(undefinedOptions).toMatchObject({ _tag: 'Success' })
      expectGeneratedChunk(undefinedOptions)

      const explicitUndefinedLevels = generateAtLevels(undefined)
      expectTypedFailure(explicitUndefinedLevels)
      expect(explicitUndefinedLevels).toMatchObject({ failure: { field: 'terrainLevels' } })
    }),
  )
})
