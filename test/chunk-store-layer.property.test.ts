import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import { Effect, Layer, Result } from 'effect'
import { makeInMemoryStorage, StoragePort } from '@nerima-games/mc-save'
import {
  ChunkCapacity,
  ChunkStore,
  PersistentGeneratedDimensionChunkStoreLayer,
} from '../src/index'
import { noiseSeed } from './fixtures/validated-inputs'

const DIMENSIONS = ['end', 'nether', 'overworld'] as const
const arbitraryDimension = fc.constantFrom(...DIMENSIONS)
const capacity = Result.getOrThrow(ChunkCapacity.result(1))
const seed = noiseSeed(0)

describe('PersistentGeneratedDimensionChunkStoreLayer properties', () => {
  it.effect('returns a typed mismatch failure or builds a valid layer for every dimension pair', () =>
    Effect.gen(function* () {
      const storage = yield* makeInMemoryStorage

      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(arbitraryDimension, arbitraryDimension, async (generated, persisted) => {
            const outcome = await Effect.runPromise(
              Effect.match(
                Effect.provide(
                  ChunkStore,
                  PersistentGeneratedDimensionChunkStoreLayer(
                    seed,
                    generated,
                    { dimension: persisted, worldId: 'typed-error-property' },
                    capacity,
                  ).pipe(Layer.provide(Layer.succeed(StoragePort, storage))),
                ),
                {
                  onFailure: (error) => ({ error, kind: 'failure' as const }),
                  onSuccess: () => ({ kind: 'success' as const }),
                },
              ),
            )

            if (generated === persisted) {
              expect(outcome).toStrictEqual({ kind: 'success' })
              return
            }

            expect(outcome).toMatchObject({
              error: {
                _tag: 'PersistentGeneratedDimensionMismatch',
                generatedDimension: generated,
                persistenceDimension: persisted,
              },
              kind: 'failure',
            })
          }),
        ),
      )
    }),
  )
})
