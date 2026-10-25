/**
 * `ChunkStore`: residency, the block write path, and the dirty channel.
 *
 * The vertical slice this service unblocks has its own file
 * (`test/vertical-slice.test.ts`). This one pins the pieces individually, and
 * in particular the four properties the channel design rests on:
 *
 *   1. de-duplication — N writes to one chunk are one entry;
 *   2. independence — two subscribers do not consume each other's news;
 *   3. O(changed) — an idle world drains empty, always;
 *   4. changed and removed are exclusive, so a subscriber never has to
 *      reconcile "mesh it" with "dispose it".
 */
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer, Result } from 'effect'
import { makeInMemoryStorage, StoragePort } from '@nerima-games/mc-save'
import type { ChunkPersistenceContext } from '../src/application/chunk-persistence'
import {
  ChunkStore,
  ChunkStoreLayer,
  ChunkCapacity,
  GeneratedChunkStoreLayer,
  GeneratedDimensionChunkStoreLayer,
  PersistentGeneratedChunkStoreLayer,
  PersistentGeneratedDimensionChunkStoreLayer,
  generatedChunkSource,
  generatedDimensionChunkSource,
  type ChunkSource,
  type ChunkStoreError,
} from '../src/application/chunk-store'
import { BLOCK } from '../src/domain/biome'
import { emptyBlocks, type Chunk } from '../src/domain/chunk'
import { chunkKeyOf, wasWritten } from '../src/domain/chunk-store-state'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import type { ChunkCoord } from '@nerima-games/mc-kernel'
import {
  blockAxis,
  chunkAxis,
  noiseSeed,
  validatedBlockPosition as blockPosition,
  validatedChunkCoord as chunkCoord,
} from './fixtures/validated-inputs'


// ---------------------------------------------------------------------------
// A deterministic world with no noise in it.
//
// `ChunkSource` is the injection seam plan.md §3.7 asks for ("ワーカープール
// Port、実装は利用側が注入"), and a test is a consumer like any other. Using it
// here means these assertions are about the STORE and not about terrain: a
// change to the biome table cannot turn this file red.
// ---------------------------------------------------------------------------

/** Solid stone up to and including `surfaceY`, air above. */
const flatChunk = (coord: ChunkCoord, surfaceY: number): Chunk => {
  const blocks = emptyBlocks()

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      blocks[blockIndex(lx, 0, lz)] = BLOCK.BEDROCK
      for (let y = 1; y <= surfaceY; y += 1) {
        blocks[blockIndex(lx, y, lz)] = BLOCK.STONE
      }
    }
  }

  return {
    coord,
    blocks,
    biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
  }
}

const FLAT_SURFACE_Y = 63

const flatSource: ChunkSource = (coord) => Effect.sync(() => flatChunk(coord, FLAT_SURFACE_Y))

const capacity = (value: number) => Result.getOrThrow(ChunkCapacity.result(value))
const TEST_CAPACITY = capacity(64)
const TWO_CHUNK_CAPACITY = capacity(2)

const flatWorld = ChunkStoreLayer(flatSource, TEST_CAPACITY)

/** Run an Effect against a fresh store. Each test gets its own — no singleton. */
const withStore = <A>(
  body: (store: Effect.Success<typeof ChunkStore>) => Effect.Effect<A, ChunkStoreError>,
) =>
  Effect.flatMap(ChunkStore, body).pipe(Effect.provide(flatWorld))

describe('generated chunk sources', () => {
  it.effect('selects deterministic terrain by dimension without changing the default Overworld source', () =>
    Effect.gen(function* () {
      const coord = chunkCoord(chunkAxis(0), 0)
      const legacy = yield* generatedChunkSource(noiseSeed(42))(coord)
      const overworld = yield* generatedDimensionChunkSource(noiseSeed(42), 'overworld')(coord)
      const nether = yield* generatedDimensionChunkSource(noiseSeed(42), 'nether')(coord)
      const end = yield* generatedDimensionChunkSource(noiseSeed(42), 'end')(coord)

      expect(overworld).toStrictEqual(legacy)
      expect(new Set(nether.biomes)).toStrictEqual(new Set(['NETHER']))
      expect(new Set(end.biomes)).toStrictEqual(new Set(['END']))
      expect(nether.blocks).not.toStrictEqual(end.blocks)
    }),
  )

  it.effect('GeneratedChunkStoreLayer wires the deterministic generator into a store', () =>
    Effect.gen(function* () {
      const viaLayer = yield* Effect.provide(ChunkStore, GeneratedChunkStoreLayer(noiseSeed(1234), TEST_CAPACITY))
      const viaManualComposition = yield* Effect.provide(
        ChunkStore,
        ChunkStoreLayer(generatedChunkSource(noiseSeed(1234)), TEST_CAPACITY),
      )

      const coord = chunkCoord(chunkAxis(2), -3)
      const fromLayer = yield* viaLayer.load(coord)
      const fromManualComposition = yield* viaManualComposition.load(coord)

      // The convenience Layer is not a second code path: the same seed must
      // generate byte-identical terrain through either route.
      expect(fromLayer.blocks).toStrictEqual(fromManualComposition.blocks)
      expect(fromLayer.biomes).toStrictEqual(fromManualComposition.biomes)
    }),
  )

  it.effect('GeneratedDimensionChunkStoreLayer selects terrain by dimension through the Layer', () =>
    Effect.gen(function* () {
      const netherStore = yield* Effect.provide(
        ChunkStore,
        GeneratedDimensionChunkStoreLayer(noiseSeed(7), 'nether', TEST_CAPACITY),
      )
      const endStore = yield* Effect.provide(
        ChunkStore,
        GeneratedDimensionChunkStoreLayer(noiseSeed(7), 'end', TEST_CAPACITY),
      )

      const nether = yield* netherStore.load(chunkCoord(chunkAxis(0), 0))
      const end = yield* endStore.load(chunkCoord(chunkAxis(0), 0))

      expect(new Set(nether.biomes)).toStrictEqual(new Set(['NETHER']))
      expect(new Set(end.biomes)).toStrictEqual(new Set(['END']))
    }),
  )

  it.effect('PersistentGeneratedChunkStoreLayer persists generated terrain across an unload/reload', () =>
    Effect.gen(function* () {
      const storage = yield* makeInMemoryStorage
      const context: ChunkPersistenceContext = { dimension: 'overworld', worldId: 'layer-test' }
      const coord = chunkCoord(chunkAxis(5), 5)

      const provideStore = (): Layer.Layer<ChunkStore> =>
        PersistentGeneratedChunkStoreLayer(noiseSeed(999), context, TEST_CAPACITY).pipe(
          Layer.provide(Layer.succeed(StoragePort, storage)),
        )

      // `coord` is chunk (5, 5), so the write must land inside its own
      // world-coordinate range — (0, 10, 0) is a different, unloaded chunk
      // and `setBlock` would silently no-op there (`ChunkNotLoaded`).
      const writePosition = blockPosition(blockAxis(coord.cx * CHUNK_SIZE_XZ), 10, coord.cz * CHUNK_SIZE_XZ)

      const first = yield* Effect.provide(ChunkStore, provideStore())
      yield* first.load(coord)
      const outcome = yield* first.setBlock(writePosition, BLOCK.SAND)
      expect(outcome._tag, 'the write missed its own chunk').toBe('Written')
      // A detached copy, taken before unload, to compare the round trip
      // against something that cannot change out from under this test via
      // the live-view aliasing `aliasing is stated, not hidden` documents.
      const beforeUnload = yield* first.snapshot(coord)
      yield* first.unload(coord)

      const second = yield* Effect.provide(ChunkStore, provideStore())
      const restored = yield* second.load(coord)

      expect(restored.blocks).toStrictEqual(beforeUnload?.blocks)
      expect(restored.blocks[blockIndex(0, 10, 0)]).toBe(BLOCK.SAND)
    }),
  )

  it('rejects persistence under another dimension namespace', () => {
    expect(() =>
      PersistentGeneratedDimensionChunkStoreLayer(
        noiseSeed(42),
        'nether',
        { dimension: 'end', worldId: 'test-world' },
        TEST_CAPACITY,
      ),
    ).toThrow(/does not match persistence dimension/u)
    expect(() =>
      PersistentGeneratedDimensionChunkStoreLayer(
        noiseSeed(42),
        'nether',
        { dimension: 'nether', worldId: 'test-world' },
        TEST_CAPACITY,
      ),
    ).not.toThrow()
  })
})

describe('residency', () => {
  it.effect('generates a chunk on first load and returns the same one after', () =>
    withStore((store) =>
      Effect.gen(function* () {
        const coord = chunkCoord(chunkAxis(0), 0)

        expect(yield* store.isLoaded(coord)).toBe(false)

        const first = yield* store.load(coord)
        expect(yield* store.isLoaded(coord)).toBe(true)

        const second = yield* store.load(coord)
        // Identity, not equality: two live views of one chunk would let two
        // writers each see only their own edits.
        expect(second).toBe(first)
      }),
    ),
  )

  it.effect('peek does not generate', () =>
    withStore((store) =>
      Effect.gen(function* () {
        expect(yield* store.peek(chunkCoord(chunkAxis(5), 5))).toBeUndefined()
        expect(yield* store.isLoaded(chunkCoord(chunkAxis(5), 5))).toBe(false)
      }),
    ),
  )

  it.effect('snapshot of a non-resident coordinate is undefined, not a generated chunk', () =>
    withStore((store) =>
      Effect.gen(function* () {
        expect(yield* store.snapshot(chunkCoord(chunkAxis(6), 6))).toBeUndefined()
        expect(yield* store.isLoaded(chunkCoord(chunkAxis(6), 6))).toBe(false)
      }),
    ),
  )

  /**
   * `load`'s own doc comment states the property: "another fiber can have
   * loaded this coordinate meanwhile; the first one to land wins and the
   * loser's buffer is discarded. Handing out two live views of one chunk
   * would let two writers each see only their own edits." This constructs
   * that race deterministically rather than hoping concurrent scheduling
   * happens to produce it.
   *
   * The losing fiber is held at `source` (not at the final `Ref.modify`)
   * with a `Deferred`, so the winner is guaranteed to finish first and write
   * state before the loser's own `Ref.modify` runs — that ordering, not
   * timing, is what makes the loser see `raced !== undefined`.
   */
  it.effect('a losing concurrent load discards its own buffer and returns the winner\'s', () =>
    Effect.gen(function* () {
      const coord = chunkCoord(chunkAxis(2), 2)
      const enteredSource = yield* Deferred.make<void>()
      const proceed = yield* Deferred.make<void>()
      let generateCount = 0

      const racySource: ChunkSource = (c) =>
        Effect.gen(function* () {
          generateCount += 1
          const isFirstCaller = generateCount === 1
          if (isFirstCaller) {
            // The loser: signals it has reached this point (so the parent's
            // wait below is exact rather than a guess about scheduling), then
            // blocks — before it ever reaches its own `Ref.modify` — until
            // the winner has already written state.
            yield* Deferred.succeed(enteredSource, undefined)
            yield* Deferred.await(proceed)
          }
          return { biomes: [], blocks: emptyBlocks(), coord: c }
        })

      const store = yield* Effect.provide(ChunkStore, ChunkStoreLayer(racySource, TEST_CAPACITY))

      const losingFiber = yield* store.load(coord).pipe(Effect.forkChild)
      // Deterministic, not timing-dependent: waits exactly until the loser
      // has entered `source` and parked, so `generateCount` is guaranteed to
      // be 1 before the winner's own call to `source` runs.
      yield* Deferred.await(enteredSource)

      const winner = yield* store.load(coord)
      yield* Deferred.succeed(proceed, undefined)
      const loser = yield* Fiber.join(losingFiber)

      expect(generateCount).toBe(2)
      // Reference identity, not structural equality: if the loser did not
      // check `raced` and just inserted its own generated buffer, `loser`
      // would be a DIFFERENT object holding a different chunk from `winner`.
      expect(loser).toBe(winner)
      expect(yield* store.load(coord)).toBe(winner)
    }),
  )

  it.effect('unload reports whether anything was resident', () =>
    withStore((store) =>
      Effect.gen(function* () {
        expect(yield* store.unload(chunkCoord(chunkAxis(1), 1))).toBe(false)
        yield* store.load(chunkCoord(chunkAxis(1), 1))
        expect(yield* store.unload(chunkCoord(chunkAxis(1), 1))).toBe(true)
        expect(yield* store.isLoaded(chunkCoord(chunkAxis(1), 1))).toBe(false)
      }),
    ),
  )

  it.effect('lists what is resident', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))
        yield* store.load(chunkCoord(chunkAxis(-1), 2))

        const coords = yield* store.loadedCoords
        expect(coords.map(chunkKeyOf).sort()).toStrictEqual(['-1,2', '0,0'])
      }),
    ),
  )

  it.effect('hands mc-meshing its four neighbours, and omits the ones that are absent', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))
        yield* store.load(chunkCoord(chunkAxis(1), 0))
        yield* store.load(chunkCoord(chunkAxis(0), -1))

        const neighbours = yield* store.neighbours(chunkCoord(chunkAxis(0), 0))

        expect(neighbours.xPos?.coord).toStrictEqual(chunkCoord(chunkAxis(1), 0))
        expect(neighbours.zNeg?.coord).toStrictEqual(chunkCoord(chunkAxis(0), -1))
        // Absent, not present-and-undefined: `exactOptionalPropertyTypes` makes
        // those different, and mc-meshing's `ChunkNeighbours` wants absent.
        expect('xNeg' in neighbours).toBe(false)
        expect('zPos' in neighbours).toBe(false)
      }),
    ),
  )

  it.effect('a load hit refreshes recency before the next chunk is inserted', () =>
    Effect.gen(function* () {
      const store = yield* Effect.provide(ChunkStore, ChunkStoreLayer(flatSource, TWO_CHUNK_CAPACITY))
      const first = chunkCoord(chunkAxis(0), chunkAxis(0))
      const second = chunkCoord(chunkAxis(1), chunkAxis(0))
      const third = chunkCoord(chunkAxis(2), chunkAxis(0))

      yield* store.load(first)
      yield* store.load(second)
      yield* store.load(first)
      yield* store.load(third)

      expect(yield* store.isLoaded(first)).toBe(true)
      expect(yield* store.isLoaded(second)).toBe(false)
      expect(yield* store.isLoaded(third)).toBe(true)
    }),
  )

  it.effect('peek and snapshot do not refresh recency', () =>
    Effect.gen(function* () {
      const store = yield* Effect.provide(ChunkStore, ChunkStoreLayer(flatSource, TWO_CHUNK_CAPACITY))
      const first = chunkCoord(chunkAxis(0), chunkAxis(0))
      const second = chunkCoord(chunkAxis(1), chunkAxis(0))
      const third = chunkCoord(chunkAxis(2), chunkAxis(0))

      yield* store.load(first)
      yield* store.load(second)
      expect(yield* store.peek(first)).toBeDefined()
      expect(yield* store.snapshot(first)).toBeDefined()
      yield* store.load(third)

      expect(yield* store.isLoaded(first)).toBe(false)
      expect(yield* store.isLoaded(second)).toBe(true)
      expect(yield* store.isLoaded(third)).toBe(true)
    }),
  )

  it.effect('neighbours refresh recency for the chunks they return', () =>
    Effect.gen(function* () {
      const store = yield* Effect.provide(ChunkStore, ChunkStoreLayer(flatSource, TWO_CHUNK_CAPACITY))
      const first = chunkCoord(chunkAxis(0), chunkAxis(0))
      const second = chunkCoord(chunkAxis(1), chunkAxis(0))
      const third = chunkCoord(chunkAxis(2), chunkAxis(0))

      yield* store.load(first)
      yield* store.load(second)
      expect((yield* store.neighbours(second)).xNeg?.coord).toStrictEqual(first)
      yield* store.load(third)

      expect(yield* store.isLoaded(first)).toBe(true)
      expect(yield* store.isLoaded(second)).toBe(false)
      expect(yield* store.isLoaded(third)).toBe(true)
    }),
  )
})

describe('reading a block', () => {
  it.effect('distinguishes air from not-loaded from out-of-world', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))

        expect(yield* store.getBlock(blockPosition(blockAxis(0), FLAT_SURFACE_Y, 0))).toStrictEqual({
          _tag: 'Block',
          block: BLOCK.STONE,
        })
        expect(yield* store.getBlock(blockPosition(blockAxis(0), FLAT_SURFACE_Y + 1, 0))).toStrictEqual({
          _tag: 'Block',
          block: BLOCK.AIR,
        })

        // The distinction that matters: sand at the edge of the loaded area
        // must not be told the cell below it is air.
        expect(yield* store.getBlock(blockPosition(blockAxis(1000), 10, 1000))).toStrictEqual({ _tag: 'ChunkNotLoaded' })
        expect(yield* store.getBlock(blockPosition(blockAxis(0), CHUNK_HEIGHT, 0))).toStrictEqual({ _tag: 'OutOfWorld' })
        expect(yield* store.getBlock(blockPosition(blockAxis(0), -1, 0))).toStrictEqual({ _tag: 'OutOfWorld' })
      }),
    ),
  )

  it.effect('reads negative coordinates through the right chunk', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(-1), -1))
        expect(yield* store.getBlock(blockPosition(blockAxis(-1), FLAT_SURFACE_Y, -1))).toStrictEqual({
          _tag: 'Block',
          block: BLOCK.STONE,
        })
        // One block further is a different chunk, and it is not loaded.
        expect(yield* store.getBlock(blockPosition(blockAxis(0), FLAT_SURFACE_Y, 0))).toStrictEqual({
          _tag: 'ChunkNotLoaded',
        })
      }),
    ),
  )
})

describe('writing a block', () => {
  it.effect('reports the previous block and the chunk it landed in', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))

        const outcome = yield* store.setBlock(blockPosition(blockAxis(3), FLAT_SURFACE_Y, 4), BLOCK.SAND)

        expect(outcome).toStrictEqual({
          _tag: 'Written',
          previous: BLOCK.STONE,
          chunk: chunkCoord(chunkAxis(0), 0),
        })
        expect(wasWritten(outcome)).toBe(true)
        expect(yield* store.getBlock(blockPosition(blockAxis(3), FLAT_SURFACE_Y, 4))).toStrictEqual({
          _tag: 'Block',
          block: BLOCK.SAND,
        })
      }),
    ),
  )

  it.effect('never fails, because StageRegistration.run has no error channel', () =>
    withStore((store) =>
      Effect.gen(function* () {
        // Both of these would be `Effect.fail` in a design with an error
        // channel, and a rule in mx-gameplay would have nowhere to put them.
        expect(yield* store.setBlock(blockPosition(blockAxis(500), 10, 500), BLOCK.SAND)).toStrictEqual({
          _tag: 'ChunkNotLoaded',
        })
        yield* store.load(chunkCoord(chunkAxis(0), 0))
        expect(yield* store.setBlock(blockPosition(blockAxis(0), CHUNK_HEIGHT + 5, 0), BLOCK.SAND)).toStrictEqual({
          _tag: 'OutOfWorld',
        })
      }),
    ),
  )

  it.effect('REGRESSION: rewriting the same block is Unchanged and does NOT dirty the chunk', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))
        const subscription = yield* store.subscribeDirty
        yield* subscription.drain

        const outcome = yield* store.setBlock(blockPosition(blockAxis(1), FLAT_SURFACE_Y, 1), BLOCK.STONE)

        expect(outcome).toStrictEqual({ _tag: 'Unchanged', previous: BLOCK.STONE })
        // A fluid re-asserting its level, or a redstone tick recomputing to the
        // same state, must not remesh the chunk every tick forever.
        expect(yield* subscription.drain).toStrictEqual({ changed: [], removed: [] })
      }),
    ),
  )
})

describe('the dirty channel', () => {
  it.effect('reports a chunk ONCE however many blocks changed in it', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))
        const subscription = yield* store.subscribeDirty
        yield* subscription.drain

        // A falling column moves up to 32 blocks per tick in mx-gameplay. A
        // stream would deliver 32 messages and the renderer would mesh 32
        // times; a set delivers one coordinate.
        for (let y = 1; y <= 32; y += 1) {
          yield* store.setBlock(blockPosition(blockAxis(2), y, 2), BLOCK.SAND)
        }

        const batch = yield* subscription.drain
        expect(batch.changed).toStrictEqual([chunkCoord(chunkAxis(0), 0)])
        expect(batch.removed).toStrictEqual([])
      }),
    ),
  )

  it.effect('gives each subscriber its own news', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))
        const renderer = yield* store.subscribeDirty
        const gameplay = yield* store.subscribeDirty
        yield* renderer.drain
        yield* gameplay.drain

        yield* store.setBlock(blockPosition(blockAxis(0), 10, 0), BLOCK.SAND)

        // Draining one must not consume the other's. The reference's
        // single-consumer `drainRenderDirtyChunks` could not do this.
        expect((yield* gameplay.drain).changed).toStrictEqual([chunkCoord(chunkAxis(0), 0)])
        expect((yield* renderer.drain).changed).toStrictEqual([chunkCoord(chunkAxis(0), 0)])
        expect((yield* renderer.drain).changed).toStrictEqual([])
      }),
    ),
  )

  it.effect('REGRESSION: an idle world drains empty, always — the cost is O(changed), not O(loaded)', () =>
    withStore((store) =>
      Effect.gen(function* () {
        for (let cx = 0; cx < 8; cx += 1) {
          yield* store.load(chunkCoord(chunkAxis(cx), 0))
        }

        const subscription = yield* store.subscribeDirty

        // Subscribing is not a request for a full resync: mc-render builds its
        // world by loading and meshing, and replaying everything on subscribe
        // would mesh it all twice.
        expect(yield* subscription.drain).toStrictEqual({ changed: [], removed: [] })

        for (let tick = 0; tick < 5; tick += 1) {
          expect(yield* subscription.drain).toStrictEqual({ changed: [], removed: [] })
        }
      }),
    ),
  )

  it.effect('reports an unload as removed, and never as both', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))
        const subscription = yield* store.subscribeDirty
        yield* subscription.drain

        yield* store.setBlock(blockPosition(blockAxis(0), 10, 0), BLOCK.SAND)
        yield* store.unload(chunkCoord(chunkAxis(0), 0))

        const batch = yield* subscription.drain
        // mc-render disposes the geometry; it must not also try to mesh it.
        expect(batch.changed).toStrictEqual([])
        expect(batch.removed).toStrictEqual([chunkCoord(chunkAxis(0), 0)])
      }),
    ),
  )

  it.effect('remeshes a loaded horizontal neighbour when a boundary opens or closes', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))
        const subscription = yield* store.subscribeDirty
        yield* subscription.drain

        yield* store.load(chunkCoord(chunkAxis(1), 0))

        const afterLoad = yield* subscription.drain
        expect(afterLoad.changed.map(chunkKeyOf).sort()).toStrictEqual(['0,0', '1,0'])
        expect(afterLoad.removed).toStrictEqual([])

        yield* store.unload(chunkCoord(chunkAxis(1), 0))

        const afterUnload = yield* subscription.drain
        expect(afterUnload.changed).toStrictEqual([chunkCoord(chunkAxis(0), 0)])
        expect(afterUnload.removed).toStrictEqual([chunkCoord(chunkAxis(1), 0)])
      }),
    ),
  )

  it.effect('a chunk that comes back after an unload is changed, not removed', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))
        const subscription = yield* store.subscribeDirty

        yield* store.unload(chunkCoord(chunkAxis(0), 0))
        yield* store.load(chunkCoord(chunkAxis(0), 0))

        const batch = yield* subscription.drain
        expect(batch.changed).toStrictEqual([chunkCoord(chunkAxis(0), 0)])
        expect(batch.removed).toStrictEqual([])
      }),
    ),
  )

  it.effect('unsubscribe is idempotent and its id is never reissued', () =>
    withStore((store) =>
      Effect.gen(function* () {
        const first = yield* store.subscribeDirty
        yield* first.unsubscribe
        yield* first.unsubscribe

        const second = yield* store.subscribeDirty
        expect(second.id).not.toBe(first.id)

        yield* store.load(chunkCoord(chunkAxis(0), 0))
        // A detached subscriber accumulates nothing and sees nothing.
        expect(yield* first.drain).toStrictEqual({ changed: [], removed: [] })
        expect((yield* second.drain).changed).toStrictEqual([chunkCoord(chunkAxis(0), 0)])
      }),
    ),
  )

  it.effect('scoped subscription detaches when the scope closes', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* store.subscribeDirtyScoped
            yield* store.load(chunkCoord(chunkAxis(0), 0))
            expect((yield* subscription.drain).changed).toStrictEqual([chunkCoord(chunkAxis(0), 0)])
          }),
        )

        // The leak class plan.md §3.8 is about: a second world load inheriting
        // the first world's subscribers.
        yield* store.load(chunkCoord(chunkAxis(1), 1))
        expect((yield* store.loadedCoords).length).toBe(2)
      }),
    ),
  )
})

describe('re-entrancy', () => {
  it.effect('reset empties the world AND tells every subscriber', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))
        yield* store.load(chunkCoord(chunkAxis(1), 0))
        const subscription = yield* store.subscribeDirty
        yield* subscription.drain

        yield* store.reset

        expect(yield* store.loadedCoords).toStrictEqual([])

        // Silently emptying the world would leave mc-render drawing geometry
        // for chunks that no longer exist.
        const batch = yield* subscription.drain
        expect(batch.removed.map(chunkKeyOf).sort()).toStrictEqual(['0,0', '1,0'])
        expect(batch.changed).toStrictEqual([])
      }),
    ),
  )

  it.effect('two stores are two worlds', () =>
    Effect.gen(function* () {
      const first = yield* Effect.provide(ChunkStore, ChunkStoreLayer(flatSource, TEST_CAPACITY))
      const second = yield* Effect.provide(ChunkStore, ChunkStoreLayer(flatSource, TEST_CAPACITY))

      yield* first.load(chunkCoord(chunkAxis(0), 0))
      yield* first.setBlock(blockPosition(blockAxis(0), 10, 0), BLOCK.SAND)

      expect(yield* second.isLoaded(chunkCoord(chunkAxis(0), 0))).toBe(false)
    }),
  )
})

describe('aliasing is stated, not hidden', () => {
  it.effect('a loaded chunk is a LIVE view', () =>
    withStore((store) =>
      Effect.gen(function* () {
        const chunk = yield* store.load(chunkCoord(chunkAxis(0), 0))
        const index = blockIndex(0, 10, 0)

        expect(chunk.blocks[index]).toBe(BLOCK.STONE)
        yield* store.setBlock(blockPosition(blockAxis(0), 10, 0), BLOCK.SAND)
        // The write went into the buffer the caller is holding. This is the
        // documented performance exception, and it is asserted so that nobody
        // has to discover it from a bug.
        expect(chunk.blocks[index]).toBe(BLOCK.SAND)
      }),
    ),
  )

  it.effect('a snapshot is not', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(chunkAxis(0), 0))
        const snapshot = yield* store.snapshot(chunkCoord(chunkAxis(0), 0))
        const index = blockIndex(0, 10, 0)

        yield* store.setBlock(blockPosition(blockAxis(0), 10, 0), BLOCK.SAND)

        expect(snapshot?.blocks[index]).toBe(BLOCK.STONE)
      }),
    ),
  )
})

describe('chunk keys', () => {
  it.effect('round-trip, including negatives and negative zero', () =>
    Effect.sync(() => {
      for (const coord of [chunkCoord(chunkAxis(0), 0), chunkCoord(chunkAxis(-1), 5), chunkCoord(chunkAxis(-0), -0), chunkCoord(chunkAxis(999), -999)]) {
        expect(chunkKeyOf(coord)).toBe(`${coord.cx},${coord.cz}`)
      }
      expect(chunkKeyOf(chunkCoord(chunkAxis(-0), -0))).toBe('0,0')
    }),
  )
})

describe('the default source is this repository generator', () => {
  it.effect('produces real terrain, deterministically', () =>
    Effect.gen(function* () {
      const store = yield* Effect.provide(
        ChunkStore,
        Layer.merge(ChunkStoreLayer(generatedChunkSource(noiseSeed(1234)), TEST_CAPACITY), Layer.empty),
      )

      const chunk = yield* store.load(chunkCoord(chunkAxis(0), 0))
      expect(chunk.blocks.length).toBe(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * CHUNK_HEIGHT)
      expect(chunk.blocks[blockIndex(0, 0, 0)]).toBe(BLOCK.BEDROCK)

      const snapshot = yield* store.snapshot(chunkCoord(chunkAxis(0), 0))
      const again = yield* Effect.provide(
        Effect.flatMap(ChunkStore, (other) => other.load(chunkCoord(chunkAxis(0), 0))),
        ChunkStoreLayer(generatedChunkSource(noiseSeed(1234)), TEST_CAPACITY),
      )
      expect(again.blocks).toStrictEqual(snapshot?.blocks)
    }),
  )
})
