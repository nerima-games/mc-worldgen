import { describe, expect, it } from '@effect/vitest'
import {
  makeInMemoryStorage,
  saveEnvelope,
  sealSaveEnvelope,
  StorageError,
  StoragePort,
  type StorageService,
} from '@nerima-games/mc-save'
import { Effect, Option } from 'effect'
import { chunkSaveKey, type ChunkPersistenceContext } from '../src/application/chunk-persistence'
import { makePersistentChunkStore, type ChunkSource } from '../src/application/chunk-store'
import { BLOCK } from '../src/domain/biome'
import { emptyBlocks, type Chunk } from '../src/domain/chunk'
import { CHUNK_FORMAT } from '../src/domain/chunk-format'
import { blockIndex } from '../src/domain/constants'
import { blockPosition, chunkCoord, type ChunkCoord } from '@nerima-games/mc-kernel'

const context: ChunkPersistenceContext = { worldId: 'world/one', dimension: 'overworld' }

const generatedChunk = (coord: ChunkCoord): Chunk => ({
  coord,
  blocks: emptyBlocks(),
  biomes: Array.from({ length: 256 }, () => 'PLAINS' as const),
})

const source: ChunkSource = (coord) => Effect.succeed(generatedChunk(coord))

const makeStoreWith = (storage: StorageService, chunkSource: ChunkSource = source) =>
  makePersistentChunkStore(chunkSource, context).pipe(Effect.provideService(StoragePort, storage))

describe('chunk persistence', () => {
    it('builds stable keys from typed world and dimension components', () => {
      const coord = chunkCoord(-2, 7)
      expect(chunkSaveKey({ worldId: 'a/b', dimension: 'overworld' }, coord)).toBe(
        'chunk/a%2Fb/overworld/-2/7',
      )
      expect(chunkSaveKey({ worldId: 'a', dimension: 'nether' }, coord)).toBe(
        'chunk/a/nether/-2/7',
      )
      expect(
        chunkSaveKey({ worldId: 'a', dimension: 'overworld' }, coord),
      ).not.toBe(chunkSaveKey({ worldId: 'a', dimension: 'nether' }, coord))
    })

  it.effect('loads storage before invoking the generator', () =>
    Effect.gen(function* () {
      const storage = yield* makeInMemoryStorage
      const first = yield* makeStoreWith(storage)
      const coord = chunkCoord(3, -4)
      yield* first.load(coord)
      yield* first.setBlock(blockPosition(48, 10, -64), BLOCK.STONE)
      yield* first.unload(coord)

      let generated = false
      const second = yield* makeStoreWith(storage, (missing) =>
        Effect.sync(() => {
          generated = true
          return generatedChunk(missing)
        }),
      )
      const restored = yield* second.load(coord)

      expect(generated).toBe(false)
      expect(restored.blocks[blockIndex(0, 10, 0)]).toBe(BLOCK.STONE)
    }),
  )

  it.effect('retains a resident chunk when saving during unload fails', () =>
    Effect.gen(function* () {
      const backing = yield* makeInMemoryStorage
      const failing: StorageService = {
        ...backing,
        put: (key) => Effect.fail(new StorageError({ operation: 'test.put', key })),
      }
      const store = yield* makeStoreWith(failing)
      const coord = chunkCoord(0, 0)
      yield* store.load(coord)

      const failure = yield* Effect.flip(store.unload(coord))
      expect(failure._tag).toBe('StorageError')
      expect(yield* store.isLoaded(coord)).toBe(true)
    }),
  )

  it.effect('surfaces corrupt stored chunks instead of regenerating over them', () =>
    Effect.gen(function* () {
      const storage = yield* makeInMemoryStorage
      const coord = chunkCoord(1, 2)
      yield* storage.put(
        chunkSaveKey(context, coord),
        sealSaveEnvelope(saveEnvelope(CHUNK_FORMAT.name, CHUNK_FORMAT.version, { blocks: 'not-a-chunk' })),
      )
      const store = yield* makeStoreWith(storage)

      const failure = yield* Effect.flip(store.load(coord))
      expect(failure._tag).toBe('SaveDecodeError')
      expect(yield* store.isLoaded(coord)).toBe(false)
      expect(yield* storage.get(chunkSaveKey(context, coord))).toStrictEqual(expect.objectContaining({ _tag: 'Some' }))
    }),
  )

  it.effect('treats a missing key as generation rather than an error', () =>
    Effect.gen(function* () {
      const storage = yield* makeInMemoryStorage
      expect(yield* storage.get(chunkSaveKey(context, chunkCoord(9, 9)))).toStrictEqual(Option.none())
      const store = yield* makeStoreWith(storage)
      expect((yield* store.load(chunkCoord(9, 9))).coord).toStrictEqual(chunkCoord(9, 9))
    }),
  )

  it.effect('unloading a coordinate that was never loaded is a no-op, with persistence enabled', () =>
    Effect.gen(function* () {
      const storage = yield* makeInMemoryStorage
      const store = yield* makeStoreWith(storage)
      const coord = chunkCoord(40, -40)

      expect(yield* store.unload(coord)).toBe(false)
      // Nothing was resident, so nothing should have been written either.
      expect(yield* storage.get(chunkSaveKey(context, coord))).toStrictEqual(Option.none())
    }),
  )

  /**
   * `unload`'s `saveUntilCurrent` recurses when the chunk it just saved has
   * since changed underneath it — the save-then-remove analogue of `load`'s
   * own "the first one to land wins" race. Constructed deterministically: the
   * storage's `put` (which `persistence.save` calls) writes a block through
   * the SAME store in the middle of the first save attempt, so by the time
   * that attempt's compare-and-remove runs, the resident chunk has already
   * moved past the snapshot it just persisted.
   */
  it.effect('retries the save when a write races the unload, and persists the newer content', () =>
    Effect.gen(function* () {
      const backing = yield* makeInMemoryStorage
      const coord = chunkCoord(0, 0)
      let putCount = 0

      // A mutable property rather than a reassigned variable, so
      // `racyDuringSave.put` — defined before the store it needs to call
      // back into exists — can reach it without a forward reference to a
      // not-yet-declared binding. `cell` itself is declared and never
      // rebound; only the property is filled in once the store is built.
      const cell: { store?: Effect.Effect.Success<ReturnType<typeof makeStoreWith>> } = {}

      const racyDuringSave: StorageService = {
        ...backing,
        put: (key, envelope) =>
          Effect.gen(function* () {
            putCount += 1
            if (putCount === 1 && cell.store) {
              // Races a write into the middle of the FIRST save attempt, so
              // that attempt's snapshot goes stale before its own
              // compare-and-remove runs.
              yield* cell.store.setBlock(blockPosition(0, 10, 0), BLOCK.SAND)
            }
            return yield* backing.put(key, envelope)
          }),
      }

      const store = yield* makeStoreWith(racyDuringSave)
      cell.store = store
      yield* store.load(coord)

      const removed = yield* store.unload(coord)

      expect(removed).toBe(true)
      // The stale first save was rejected by the compare-and-remove and the
      // loop tried again — if it had not, `putCount` would be 1.
      expect(putCount).toBe(2)
      expect(yield* store.isLoaded(coord)).toBe(false)

      // The retried save captured the block written during the race, not the
      // stale pre-race snapshot: reload from storage through a fresh store.
      const reloaded = yield* makeStoreWith(backing)
      const restored = yield* reloaded.load(coord)
      expect(restored.blocks[blockIndex(0, 10, 0)]).toBe(BLOCK.SAND)
    }),
  )
})
