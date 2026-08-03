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
import { Effect, Layer } from 'effect'
import type { ChunkPersistenceError } from '../src/application/chunk-persistence'
import {
  ChunkStore,
  ChunkStoreLayer,
  generatedChunkSource,
  generatedDimensionChunkSource,
  PersistentGeneratedDimensionChunkStoreLayer,
  type ChunkSource,
} from '../src/application/chunk-store'
import { BLOCK } from '../src/domain/biome'
import { emptyBlocks, type Chunk } from '../src/domain/chunk'
import { chunkKeyOf, chunkCoordOfKey, wasWritten } from '../src/domain/chunk-store-state'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { blockPosition, chunkCoord, type ChunkCoord } from '../src/domain/kernel-vocabulary'

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

const flatWorld = ChunkStoreLayer(flatSource)

/** Run an Effect against a fresh store. Each test gets its own — no singleton. */
const withStore = <A>(
  body: (store: Effect.Effect.Success<typeof ChunkStore>) => Effect.Effect<A, ChunkPersistenceError>,
) =>
  Effect.flatMap(ChunkStore, body).pipe(Effect.provide(flatWorld))

describe('generated chunk sources', () => {
  it.effect('selects deterministic terrain by dimension without changing the legacy source', () =>
    Effect.gen(function* () {
      const coord = chunkCoord(0, 0)
      const legacy = yield* generatedChunkSource(42)(coord)
      const overworld = yield* generatedDimensionChunkSource(42, 'overworld')(coord)
      const nether = yield* generatedDimensionChunkSource(42, 'nether')(coord)
      const end = yield* generatedDimensionChunkSource(42, 'end')(coord)

      expect(overworld).toStrictEqual(legacy)
      expect(new Set(nether.biomes)).toStrictEqual(new Set(['NETHER']))
      expect(new Set(end.biomes)).toStrictEqual(new Set(['END']))
      expect(nether.blocks).not.toStrictEqual(end.blocks)
    }),
  )

  it('rejects persistence under another dimension namespace', () => {
    expect(() =>
      PersistentGeneratedDimensionChunkStoreLayer(
        42,
        'nether',
        { dimension: 'end', worldId: 'test-world' },
      ),
    ).toThrow(/does not match persistence dimension/u)
    expect(() =>
      PersistentGeneratedDimensionChunkStoreLayer(
        42,
        'nether',
        { dimension: 'nether', worldId: 'test-world' },
      ),
    ).not.toThrow()
  })
})

describe('residency', () => {
  it.effect('generates a chunk on first load and returns the same one after', () =>
    withStore((store) =>
      Effect.gen(function* () {
        const coord = chunkCoord(0, 0)

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
        expect(yield* store.peek(chunkCoord(5, 5))).toBeUndefined()
        expect(yield* store.isLoaded(chunkCoord(5, 5))).toBe(false)
      }),
    ),
  )

  it.effect('unload reports whether anything was resident', () =>
    withStore((store) =>
      Effect.gen(function* () {
        expect(yield* store.unload(chunkCoord(1, 1))).toBe(false)
        yield* store.load(chunkCoord(1, 1))
        expect(yield* store.unload(chunkCoord(1, 1))).toBe(true)
        expect(yield* store.isLoaded(chunkCoord(1, 1))).toBe(false)
      }),
    ),
  )

  it.effect('lists what is resident', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(0, 0))
        yield* store.load(chunkCoord(-1, 2))

        const coords = yield* store.loadedCoords
        expect(coords.map(chunkKeyOf).sort()).toStrictEqual(['-1,2', '0,0'])
      }),
    ),
  )

  it.effect('hands mc-meshing its four neighbours, and omits the ones that are absent', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(0, 0))
        yield* store.load(chunkCoord(1, 0))
        yield* store.load(chunkCoord(0, -1))

        const neighbours = yield* store.neighbours(chunkCoord(0, 0))

        expect(neighbours.xPos?.coord).toStrictEqual(chunkCoord(1, 0))
        expect(neighbours.zNeg?.coord).toStrictEqual(chunkCoord(0, -1))
        // Absent, not present-and-undefined: `exactOptionalPropertyTypes` makes
        // those different, and mc-meshing's `ChunkNeighbours` wants absent.
        expect('xNeg' in neighbours).toBe(false)
        expect('zPos' in neighbours).toBe(false)
      }),
    ),
  )
})

describe('reading a block', () => {
  it.effect('distinguishes air from not-loaded from out-of-world', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(0, 0))

        expect(yield* store.getBlock(blockPosition(0, FLAT_SURFACE_Y, 0))).toStrictEqual({
          _tag: 'Block',
          block: BLOCK.STONE,
        })
        expect(yield* store.getBlock(blockPosition(0, FLAT_SURFACE_Y + 1, 0))).toStrictEqual({
          _tag: 'Block',
          block: BLOCK.AIR,
        })

        // The distinction that matters: sand at the edge of the loaded area
        // must not be told the cell below it is air.
        expect(yield* store.getBlock(blockPosition(1000, 10, 1000))).toStrictEqual({ _tag: 'ChunkNotLoaded' })
        expect(yield* store.getBlock(blockPosition(0, CHUNK_HEIGHT, 0))).toStrictEqual({ _tag: 'OutOfWorld' })
        expect(yield* store.getBlock(blockPosition(0, -1, 0))).toStrictEqual({ _tag: 'OutOfWorld' })
      }),
    ),
  )

  it.effect('reads negative coordinates through the right chunk', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(-1, -1))
        expect(yield* store.getBlock(blockPosition(-1, FLAT_SURFACE_Y, -1))).toStrictEqual({
          _tag: 'Block',
          block: BLOCK.STONE,
        })
        // One block further is a different chunk, and it is not loaded.
        expect(yield* store.getBlock(blockPosition(0, FLAT_SURFACE_Y, 0))).toStrictEqual({
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
        yield* store.load(chunkCoord(0, 0))

        const outcome = yield* store.setBlock(blockPosition(3, FLAT_SURFACE_Y, 4), BLOCK.SAND)

        expect(outcome).toStrictEqual({
          _tag: 'Written',
          previous: BLOCK.STONE,
          chunk: chunkCoord(0, 0),
        })
        expect(wasWritten(outcome)).toBe(true)
        expect(yield* store.getBlock(blockPosition(3, FLAT_SURFACE_Y, 4))).toStrictEqual({
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
        expect(yield* store.setBlock(blockPosition(500, 10, 500), BLOCK.SAND)).toStrictEqual({
          _tag: 'ChunkNotLoaded',
        })
        yield* store.load(chunkCoord(0, 0))
        expect(yield* store.setBlock(blockPosition(0, CHUNK_HEIGHT + 5, 0), BLOCK.SAND)).toStrictEqual({
          _tag: 'OutOfWorld',
        })
      }),
    ),
  )

  it.effect('REGRESSION: rewriting the same block is Unchanged and does NOT dirty the chunk', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(0, 0))
        const subscription = yield* store.subscribeDirty
        yield* subscription.drain

        const outcome = yield* store.setBlock(blockPosition(1, FLAT_SURFACE_Y, 1), BLOCK.STONE)

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
        yield* store.load(chunkCoord(0, 0))
        const subscription = yield* store.subscribeDirty
        yield* subscription.drain

        // A falling column moves up to 32 blocks per tick in mx-gameplay. A
        // stream would deliver 32 messages and the renderer would mesh 32
        // times; a set delivers one coordinate.
        for (let y = 1; y <= 32; y += 1) {
          yield* store.setBlock(blockPosition(2, y, 2), BLOCK.SAND)
        }

        const batch = yield* subscription.drain
        expect(batch.changed).toStrictEqual([chunkCoord(0, 0)])
        expect(batch.removed).toStrictEqual([])
      }),
    ),
  )

  it.effect('gives each subscriber its own news', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(0, 0))
        const renderer = yield* store.subscribeDirty
        const gameplay = yield* store.subscribeDirty
        yield* renderer.drain
        yield* gameplay.drain

        yield* store.setBlock(blockPosition(0, 10, 0), BLOCK.SAND)

        // Draining one must not consume the other's. The reference's
        // single-consumer `drainRenderDirtyChunks` could not do this.
        expect((yield* gameplay.drain).changed).toStrictEqual([chunkCoord(0, 0)])
        expect((yield* renderer.drain).changed).toStrictEqual([chunkCoord(0, 0)])
        expect((yield* renderer.drain).changed).toStrictEqual([])
      }),
    ),
  )

  it.effect('REGRESSION: an idle world drains empty, always — the cost is O(changed), not O(loaded)', () =>
    withStore((store) =>
      Effect.gen(function* () {
        for (let cx = 0; cx < 8; cx += 1) {
          yield* store.load(chunkCoord(cx, 0))
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
        yield* store.load(chunkCoord(0, 0))
        const subscription = yield* store.subscribeDirty
        yield* subscription.drain

        yield* store.setBlock(blockPosition(0, 10, 0), BLOCK.SAND)
        yield* store.unload(chunkCoord(0, 0))

        const batch = yield* subscription.drain
        // mc-render disposes the geometry; it must not also try to mesh it.
        expect(batch.changed).toStrictEqual([])
        expect(batch.removed).toStrictEqual([chunkCoord(0, 0)])
      }),
    ),
  )

  it.effect('remeshes a loaded horizontal neighbour when a boundary opens or closes', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(0, 0))
        const subscription = yield* store.subscribeDirty
        yield* subscription.drain

        yield* store.load(chunkCoord(1, 0))

        const afterLoad = yield* subscription.drain
        expect(afterLoad.changed.map(chunkKeyOf).sort()).toStrictEqual(['0,0', '1,0'])
        expect(afterLoad.removed).toStrictEqual([])

        yield* store.unload(chunkCoord(1, 0))

        const afterUnload = yield* subscription.drain
        expect(afterUnload.changed).toStrictEqual([chunkCoord(0, 0)])
        expect(afterUnload.removed).toStrictEqual([chunkCoord(1, 0)])
      }),
    ),
  )

  it.effect('a chunk that comes back after an unload is changed, not removed', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(0, 0))
        const subscription = yield* store.subscribeDirty

        yield* store.unload(chunkCoord(0, 0))
        yield* store.load(chunkCoord(0, 0))

        const batch = yield* subscription.drain
        expect(batch.changed).toStrictEqual([chunkCoord(0, 0)])
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

        yield* store.load(chunkCoord(0, 0))
        // A detached subscriber accumulates nothing and sees nothing.
        expect(yield* first.drain).toStrictEqual({ changed: [], removed: [] })
        expect((yield* second.drain).changed).toStrictEqual([chunkCoord(0, 0)])
      }),
    ),
  )

  it.effect('scoped subscription detaches when the scope closes', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* store.subscribeDirtyScoped
            yield* store.load(chunkCoord(0, 0))
            expect((yield* subscription.drain).changed).toStrictEqual([chunkCoord(0, 0)])
          }),
        )

        // The leak class plan.md §3.8 is about: a second world load inheriting
        // the first world's subscribers.
        yield* store.load(chunkCoord(1, 1))
        expect((yield* store.loadedCoords).length).toBe(2)
      }),
    ),
  )
})

describe('re-entrancy', () => {
  it.effect('reset empties the world AND tells every subscriber', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.load(chunkCoord(0, 0))
        yield* store.load(chunkCoord(1, 0))
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
      const first = yield* Effect.provide(ChunkStore, ChunkStoreLayer(flatSource))
      const second = yield* Effect.provide(ChunkStore, ChunkStoreLayer(flatSource))

      yield* first.load(chunkCoord(0, 0))
      yield* first.setBlock(blockPosition(0, 10, 0), BLOCK.SAND)

      expect(yield* second.isLoaded(chunkCoord(0, 0))).toBe(false)
    }),
  )
})

describe('aliasing is stated, not hidden', () => {
  it.effect('a loaded chunk is a LIVE view', () =>
    withStore((store) =>
      Effect.gen(function* () {
        const chunk = yield* store.load(chunkCoord(0, 0))
        const index = blockIndex(0, 10, 0)

        expect(chunk.blocks[index]).toBe(BLOCK.STONE)
        yield* store.setBlock(blockPosition(0, 10, 0), BLOCK.SAND)
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
        yield* store.load(chunkCoord(0, 0))
        const snapshot = yield* store.snapshot(chunkCoord(0, 0))
        const index = blockIndex(0, 10, 0)

        yield* store.setBlock(blockPosition(0, 10, 0), BLOCK.SAND)

        expect(snapshot?.blocks[index]).toBe(BLOCK.STONE)
      }),
    ),
  )
})

describe('chunk keys', () => {
  it.effect('round-trip, including negatives and negative zero', () =>
    Effect.sync(() => {
      for (const coord of [chunkCoord(0, 0), chunkCoord(-1, 5), chunkCoord(-0, -0), chunkCoord(999, -999)]) {
        expect(chunkCoordOfKey(chunkKeyOf(coord))).toStrictEqual(coord)
      }
      expect(chunkKeyOf(chunkCoord(-0, -0))).toBe('0,0')
    }),
  )
})

describe('the default source is this repository generator', () => {
  it.effect('produces real terrain, deterministically', () =>
    Effect.gen(function* () {
      const store = yield* Effect.provide(
        ChunkStore,
        Layer.merge(ChunkStoreLayer(generatedChunkSource(1234)), Layer.empty),
      )

      const chunk = yield* store.load(chunkCoord(0, 0))
      expect(chunk.blocks.length).toBe(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * CHUNK_HEIGHT)
      expect(chunk.blocks[blockIndex(0, 0, 0)]).toBe(BLOCK.BEDROCK)

      const snapshot = yield* store.snapshot(chunkCoord(0, 0))
      const again = yield* Effect.provide(
        Effect.flatMap(ChunkStore, (other) => other.load(chunkCoord(0, 0))),
        ChunkStoreLayer(generatedChunkSource(1234)),
      )
      expect(again.blocks).toStrictEqual(snapshot?.blocks)
    }),
  )
})
