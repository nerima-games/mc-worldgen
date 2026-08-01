import { describe, expect, it } from '@effect/vitest'
import {
  makeInMemoryStorage,
  saveEnvelope,
  StorageError,
  StoragePort,
  type StorageService,
} from '@nerima-games/mc-save'
import { Effect, Option } from 'effect'
import { chunkSaveKey } from '../src/application/chunk-persistence'
import { makePersistentChunkStore, type ChunkSource } from '../src/application/chunk-store'
import { BLOCK } from '../src/domain/biome'
import { emptyBlocks, type Chunk } from '../src/domain/chunk'
import { CHUNK_FORMAT } from '../src/domain/chunk-format'
import { blockIndex } from '../src/domain/constants'
import { blockPosition, chunkCoord, type ChunkCoord } from '../src/domain/kernel-vocabulary'

const context = { worldId: 'world/one', dimension: 'over/world' }

const generatedChunk = (coord: ChunkCoord): Chunk => ({
  coord,
  blocks: emptyBlocks(),
  biomes: Array.from({ length: 256 }, () => 'PLAINS' as const),
})

const source: ChunkSource = (coord) => Effect.succeed(generatedChunk(coord))

const makeStoreWith = (storage: StorageService, chunkSource: ChunkSource = source) =>
  makePersistentChunkStore(chunkSource, context).pipe(Effect.provideService(StoragePort, storage))

describe('chunk persistence', () => {
  it('builds stable keys without allowing component delimiter collisions', () => {
    const coord = chunkCoord(-2, 7)
    expect(chunkSaveKey({ worldId: 'a/b', dimension: 'c' }, coord)).toBe('chunk/a%2Fb/c/-2/7')
    expect(chunkSaveKey({ worldId: 'a', dimension: 'b/c' }, coord)).toBe('chunk/a/b%2Fc/-2/7')
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
        saveEnvelope(CHUNK_FORMAT.name, CHUNK_FORMAT.version, { blocks: 'not-a-chunk' }),
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
})
