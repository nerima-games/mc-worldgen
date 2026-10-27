import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import {
  ChunkCapacity,
  ChunkStore,
  ChunkStoreLayer,
  type ChunkSource,
} from '../src/application/chunk-store'
import { BLOCK } from '../src/domain/biome'
import { emptyBlocks } from '../src/domain/chunk'
import { CHUNK_SIZE_XZ, blockIndex } from '../src/domain/constants'
import { validatedBlockPosition as blockPosition, validatedChunkCoord as chunkCoord } from './fixtures/validated-inputs'

const TEST_CAPACITY = Result.getOrThrow(ChunkCapacity.result(4))

const airSource: ChunkSource = (coord) =>
  Effect.sync(() => ({
    coord,
    blocks: emptyBlocks(),
    biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
  }))

const freshStore = () => Effect.provide(ChunkStore, ChunkStoreLayer(airSource, TEST_CAPACITY))

type PublishOutcome =
  | { readonly _tag: 'Failure'; readonly error: unknown }
  | { readonly _tag: 'Success' }

const capturePublish = (
  store: Effect.Success<typeof ChunkStore>,
  prepared: Parameters<Effect.Success<typeof ChunkStore>['publish']>[0],
) =>
  Effect.match(store.publish(prepared), {
    onFailure: (error) => ({ _tag: 'Failure' as const, error: error as unknown }),
    onSuccess: () => ({ _tag: 'Success' as const }),
  })

const expectStaleFailure = (outcome: PublishOutcome, key: string, actualRevisionAbsent = false) => {
  expect(outcome).toMatchObject({
    _tag: 'Failure',
    error: expect.objectContaining({
      _tag: 'ChunkWriteStale',
      key,
      expectedRevision: expect.any(Number),
      ...(actualRevisionAbsent ? {} : { actualRevision: expect.any(Number) }),
    }),
  })

  if (outcome._tag === 'Failure') {
    const error = outcome.error as { readonly expectedRevision?: unknown; readonly actualRevision?: unknown }
    if (actualRevisionAbsent) {
      expect(Object.hasOwn(error, 'actualRevision')).toBe(false)
    } else {
      expect(error.expectedRevision).not.toBe(error.actualRevision)
    }
  }
}

const expectInvalidTokenFailure = (outcome: PublishOutcome, reason: string) => {
  expect(outcome).toMatchObject({
    _tag: 'Failure',
    error: expect.objectContaining({
      _tag: 'ChunkWriteTokenInvalid',
      reason,
    }),
  })
}

describe('ChunkStore.publish regression cases', () => {
  it.effect('rejects a stale write and preserves the first publish', () =>
    Effect.gen(function* () {
      const store = yield* freshStore()
      const coord = chunkCoord(0, 0)
      const position = blockPosition(1, 64, 1)
      const index = blockIndex(1, 64, 1)

      yield* store.load(coord)
      const preparedA = yield* Effect.orDie(store.prepare([{ position, block: BLOCK.SAND }]))
      const preparedB = yield* Effect.orDie(store.prepare([{ position, block: BLOCK.GRAVEL }]))

      yield* store.publish(preparedA)
      const publishedA = yield* store.peek(coord)
      const outcomeB = yield* capturePublish(store, preparedB)
      const afterB = yield* store.peek(coord)

      expectStaleFailure(outcomeB, '0,0')
      expect(afterB).toBe(publishedA)
      expect(afterB?.blocks[index]).toBe(BLOCK.SAND)
    }),
  )

  it.effect('rejects a stale multi-chunk batch without publishing its other chunk', () =>
    Effect.gen(function* () {
      const store = yield* freshStore()
      const firstCoord = chunkCoord(0, 0)
      const secondCoord = chunkCoord(1, 0)
      const firstPosition = blockPosition(1, 64, 1)
      const secondPosition = blockPosition(17, 64, 1)
      const firstIndex = blockIndex(1, 64, 1)
      const secondIndex = blockIndex(1, 64, 1)
      const firstBefore = yield* store.load(firstCoord)
      yield* store.load(secondCoord)

      const staleBatch = yield* Effect.orDie(
        store.prepare([
          { position: firstPosition, block: BLOCK.SAND },
          { position: secondPosition, block: BLOCK.GRAVEL },
        ]),
      )
      const winner = yield* Effect.orDie(store.prepare([{ position: secondPosition, block: BLOCK.DIRT }]))
      yield* store.publish(winner)
      const secondAfterWinner = yield* store.peek(secondCoord)

      const staleOutcome = yield* capturePublish(store, staleBatch)
      const firstAfterStale = yield* store.peek(firstCoord)
      const secondAfterStale = yield* store.peek(secondCoord)

      expectStaleFailure(staleOutcome, '1,0')
      expect(firstAfterStale).toBe(firstBefore)
      expect(firstAfterStale?.blocks[firstIndex]).toBe(BLOCK.AIR)
      expect(secondAfterStale).toBe(secondAfterWinner)
      expect(secondAfterStale?.blocks[secondIndex]).toBe(BLOCK.DIRT)
    }),
  )

  it.effect('rejects a prepared write after its chunk unloads and reloads', () =>
    Effect.gen(function* () {
      const store = yield* freshStore()
      const coord = chunkCoord(0, 0)
      const position = blockPosition(1, 64, 1)
      const index = blockIndex(1, 64, 1)
      const initial = yield* store.load(coord)
      const prepared = yield* Effect.orDie(store.prepare([{ position, block: BLOCK.SAND }]))
      const changes = yield* store.subscribeDirty
      yield* changes.drain

      yield* store.unload(coord)
      yield* changes.drain
      const absentOutcome = yield* capturePublish(store, prepared)
      expectStaleFailure(absentOutcome, '0,0', true)

      const reloaded = yield* store.load(coord)
      yield* changes.drain

      const outcome = yield* capturePublish(store, prepared)
      const after = yield* store.peek(coord)
      const dirty = yield* changes.drain

      expectStaleFailure(outcome, '0,0')
      expect(reloaded).not.toBe(initial)
      expect(after).toBe(reloaded)
      expect(after?.blocks[index]).toBe(BLOCK.AIR)
      expect(dirty).toStrictEqual({ changed: [], removed: [] })
    }),
  )

  it.effect('rejects a token from another store without changing either store', () =>
    Effect.gen(function* () {
      const owner = yield* freshStore()
      const receiver = yield* freshStore()
      const coord = chunkCoord(0, 0)
      const position = blockPosition(1, 64, 1)
      const index = blockIndex(1, 64, 1)
      const ownerBefore = yield* owner.load(coord)
      const receiverBefore = yield* receiver.load(coord)
      const prepared = yield* Effect.orDie(owner.prepare([{ position, block: BLOCK.SAND }]))
      const receiverChanges = yield* receiver.subscribeDirty
      yield* receiverChanges.drain

      const outcome = yield* capturePublish(receiver, prepared)
      const ownerAfter = yield* owner.peek(coord)
      const receiverAfter = yield* receiver.peek(coord)
      const receiverDirty = yield* receiverChanges.drain

      expectInvalidTokenFailure(outcome, 'foreign_store')
      expect(ownerAfter).toBe(ownerBefore)
      expect(ownerAfter?.blocks[index]).toBe(BLOCK.AIR)
      expect(receiverAfter).toBe(receiverBefore)
      expect(receiverAfter?.blocks[index]).toBe(BLOCK.AIR)
      expect(receiverDirty).toStrictEqual({ changed: [], removed: [] })
    }),
  )

  it.effect('rejects a token after its first publish without changing the published state', () =>
    Effect.gen(function* () {
      const store = yield* freshStore()
      const coord = chunkCoord(0, 0)
      const position = blockPosition(1, 64, 1)
      const index = blockIndex(1, 64, 1)
      yield* store.load(coord)
      const prepared = yield* Effect.orDie(store.prepare([{ position, block: BLOCK.SAND }]))
      const changes = yield* store.subscribeDirty
      yield* changes.drain

      yield* store.publish(prepared)
      const published = yield* store.peek(coord)
      yield* changes.drain

      const outcome = yield* capturePublish(store, prepared)
      const afterSecondPublish = yield* store.peek(coord)
      const dirtyAfterSecondPublish = yield* changes.drain

      expectInvalidTokenFailure(outcome, 'already_published')
      expect(afterSecondPublish).toBe(published)
      expect(afterSecondPublish?.blocks[index]).toBe(BLOCK.SAND)
      expect(dirtyAfterSecondPublish).toStrictEqual({ changed: [], removed: [] })
    }),
  )

  it.effect('rejects an unknown token without changing the store', () =>
    Effect.gen(function* () {
      const store = yield* freshStore()
      const coord = chunkCoord(0, 0)
      const index = blockIndex(1, 64, 1)
      const before = yield* store.load(coord)
      const changes = yield* store.subscribeDirty
      yield* changes.drain
      const unknownToken = {} as Parameters<Effect.Success<typeof ChunkStore>['publish']>[0]

      const outcome = yield* capturePublish(store, unknownToken)
      const after = yield* store.peek(coord)
      const dirty = yield* changes.drain

      expectInvalidTokenFailure(outcome, 'unknown_token')
      expect(after).toBe(before)
      expect(after?.blocks[index]).toBe(BLOCK.AIR)
      expect(dirty).toStrictEqual({ changed: [], removed: [] })
    }),
  )

  it.effect('publishes an unchanged batch without changing residency or dirty state', () =>
    Effect.gen(function* () {
      const store = yield* freshStore()
      const coord = chunkCoord(0, 0)
      const position = blockPosition(1, 64, 1)
      const before = yield* store.load(coord)
      const changes = yield* store.subscribeDirty
      yield* changes.drain
      const prepared = yield* Effect.orDie(store.prepare([{ position, block: BLOCK.AIR }]))

      expect(prepared.changes).toEqual([])
      yield* store.publish(prepared)

      expect(yield* store.peek(coord)).toBe(before)
      expect(yield* changes.drain).toStrictEqual({ changed: [], removed: [] })
    }),
  )
})
