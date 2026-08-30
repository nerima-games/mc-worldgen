/**
 * THE SLICE. Break a block; it is removed from the store; the chunk is reported
 * dirty; a falling-block rule observes it and the sand above falls.
 *
 * ---------------------------------------------------------------------------
 * What this file is and is not
 * ---------------------------------------------------------------------------
 *
 * The vertical-slice spike ran `kernel → physics → worldgen → sim → render →
 * gameplay` and found that no repository owned block state: mc-sim owns Player,
 * Inventory, Time, Autosave and the GameLoop; mc-worldgen exported
 * `generateChunk`, a pure function returning a value. Nothing held blocks and
 * nothing accepted a write, so the spike invented a `BlockStore` in throwaway
 * code to make this scenario run at all. `ChunkStore` is that store, made real
 * and given an owner.
 *
 * The RULE half of the scenario is written out below rather than imported.
 * That is not a shortcut, it is the architecture: "sand falls when unsupported"
 * is a verb and verbs live in mx-gameplay (plan.md §2.3-1), which this
 * repository must not depend on — that edge is intentionally absent from the
 * dependency graph. What is asserted here is therefore precisely
 * "the store AFFORDS the rule", which is the claim that was in doubt. The rule
 * itself, and the same scenario driven through mx-gameplay's real
 * `FallingBlockQueue`, is `mx-gameplay/test/vertical-slice.test.ts`.
 *
 * Three things had to be true for this file to be writable at all, and none of
 * them were before:
 *
 *  1. something holds chunks and accepts a write — `ChunkStore.setBlock`;
 *  2. something answers "which chunks changed since I last looked" —
 *     `ChunkStore.subscribeDirty`, with the writer in another repository;
 *  3. `fallsWhenUnsupported` is answerable from a chunk buffer BYTE — kernel's
 *     `capabilityOfBlockId`.
 *
 * Note what does NOT appear anywhere in the rule: a block name. The reference
 * implementation asked `blockTypeToIndex('SAND')` in 229 places across 51 files
 * (plan.md §3.1) and that is what made engine/content separation impossible.
 * Here the rule sees a number out of a `Uint8Array` and asks the capability
 * table about it.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ChunkStore, ChunkStoreLayer, type ChunkSource } from '../src/application/chunk-store'
import { BLOCK } from '../src/domain/biome'
import { emptyBlocks, type Chunk } from '../src/domain/chunk'
import type { ChunkDirtyBatch } from '../src/domain/chunk-store-state'
import { blockIndex, CHUNK_SIZE_XZ } from '../src/domain/constants'
import {
  blockPosition,
  capabilityOfBlockId,
  chunkCoord,
  type BlockId,
  type BlockPosition,
} from '@nerima-games/mc-kernel'

const fallsWhenUnsupported = (id: number): boolean => capabilityOfBlockId(id, 'fallsWhenUnsupported')
const replaceable = (id: number): boolean => capabilityOfBlockId(id, 'replaceable')

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

const SUPPORT_Y = 64
const SAND_Y = 65

/**
 * How high the miniature rule below scans a dirty column.
 *
 * The real rule does not scan at all — mx-gameplay's `FallingBlockQueue` holds
 * individual disturbed POSITIONS, so its cost is O(moves) rather than
 * O(column). Chunk granularity is what this repository publishes and position
 * granularity is what the rule keeps privately; the two compose, and the
 * scan here is the price of not importing mx-gameplay.
 */
const SCAN_CEILING_Y = SAND_Y + 6

/**
 * Bedrock at 0, stone to `SUPPORT_Y`, and a single sand block resting on top of
 * the column at (2, 3) — the minimum world in which "break the support and the
 * sand falls" is a meaningful sentence.
 */
const slabChunk = (): Chunk => {
  const blocks = emptyBlocks()

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      blocks[blockIndex(lx, 0, lz)] = BLOCK.BEDROCK
      for (let y = 1; y <= SUPPORT_Y; y += 1) {
        blocks[blockIndex(lx, y, lz)] = BLOCK.STONE
      }
    }
  }

  blocks[blockIndex(2, SAND_Y, 3)] = BLOCK.SAND

  return {
    coord: chunkCoord(0, 0),
    blocks,
    biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
  }
}

const slabSource: ChunkSource = () => Effect.sync(slabChunk)

// ---------------------------------------------------------------------------
// The rule half, as mx-gameplay would write it
// ---------------------------------------------------------------------------

/**
 * One tick of the falling-block rule, restricted to the columns of the chunks
 * a drain reported.
 *
 * This is a faithful miniature of what `gameplay:entities` does: work enters
 * only through the dirty channel, so an untouched world does no work at all —
 * the property `mx-gameplay/domain/falling-block.ts` exists to guarantee, after
 * the reference's every-chunk sweep cost ~7M block reads per maintenance tick
 * (~40% of the main thread while exploring).
 *
 * Resolves to the number of blocks moved, so a test can assert that an idle
 * tick moves nothing.
 */
const fallingBlockTick = (
  store: Effect.Effect.Success<typeof ChunkStore>,
  batch: ChunkDirtyBatch,
): Effect.Effect<number> =>
  Effect.gen(function* () {
    let moved = 0

    for (const coord of batch.changed) {
      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          for (let y = 1; y < SCAN_CEILING_Y; y += 1) {
            const here: BlockPosition = blockPosition(coord.cx * CHUNK_SIZE_XZ + lx, y, coord.cz * CHUNK_SIZE_XZ + lz)
            const reading = yield* store.getBlock(here)
            if (reading._tag !== 'Block' || !fallsWhenUnsupported(reading.block)) {
              continue
            }

            const below = blockPosition(here.x, here.y - 1, here.z)
            const under = yield* store.getBlock(below)
            // `ChunkNotLoaded` is NOT air: sand at the edge of the loaded area
            // must not fall into ungenerated space. This is the whole reason
            // `BlockReading` is three-valued.
            if (under._tag !== 'Block' || !replaceable(under.block)) {
              continue
            }

            yield* store.setBlock(here, BLOCK.AIR)
            yield* store.setBlock(below, reading.block as BlockId)
            moved += 1
          }
        }
      }
    }

    return moved
  })

// ---------------------------------------------------------------------------

describe('the slice: break a block, it falls, and the renderer hears about it', () => {
  it.effect('runs end to end', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore

      // Two independent readers, exactly as the frame has: mc-render's
      // `render:chunk-sync` stage and mx-gameplay's `gameplay:entities` stage.
      const renderer = yield* store.subscribeDirty
      const gameplay = yield* store.subscribeDirty

      yield* store.load(chunkCoord(0, 0))

      // Loading is itself news; clear it so the assertions below are about the
      // player's action and nothing else.
      yield* renderer.drain
      yield* gameplay.drain

      const support = blockPosition(2, SUPPORT_Y, 3)
      const sandAt = blockPosition(2, SAND_Y, 3)

      // ---- 1. break the block ------------------------------------------------
      const broken = yield* store.setBlock(support, BLOCK.AIR)

      expect(broken).toStrictEqual({
        _tag: 'Written',
        previous: BLOCK.STONE,
        chunk: chunkCoord(0, 0),
      })

      // ---- 2. it is removed from the store -----------------------------------
      expect(yield* store.getBlock(support)).toStrictEqual({ _tag: 'Block', block: BLOCK.AIR })

      // The mined block is what mc-sim's InventoryService receives. mx-gameplay
      // reads it off `previous` — which is why `setBlock` reports it rather
      // than making the caller read before writing (a read-then-write is the
      // TOCTOU plan.md §3.8 warns about, and it would race a second miner).
      expect(broken._tag === 'Written' ? broken.previous : undefined).toBe(BLOCK.STONE)

      // ---- 3. the chunk is reported dirty ------------------------------------
      const gameplayBatch = yield* gameplay.drain
      expect(gameplayBatch.changed).toStrictEqual([chunkCoord(0, 0)])
      expect(gameplayBatch.removed).toStrictEqual([])

      // ---- 4. a falling-block rule observes it -------------------------------
      const movedFirstTick = yield* fallingBlockTick(store, gameplayBatch)
      expect(movedFirstTick).toBe(1)

      expect(yield* store.getBlock(sandAt)).toStrictEqual({ _tag: 'Block', block: BLOCK.AIR })
      expect(yield* store.getBlock(support)).toStrictEqual({ _tag: 'Block', block: BLOCK.SAND })

      // ---- 5. the renderer sees ONE dirty chunk for all of it ----------------
      // Three writes happened (the break, and the sand's two-step move). The
      // renderer meshes the chunk once.
      const rendererBatch = yield* renderer.drain
      expect(rendererBatch.changed).toStrictEqual([chunkCoord(0, 0)])

      // ---- 6. and then the world goes quiet ON ITS OWN -----------------------
      // The rule's own writes dirtied the chunk again, which is correct: the
      // cell the sand moved into has to be re-examined, and that is exactly
      // what `settled` does in mx-gameplay's queue. One more tick finds the
      // sand resting on stone, moves nothing, and dirties nothing — so the
      // loop terminates without anyone deciding it should.
      expect((yield* gameplay.drain).changed).toStrictEqual([chunkCoord(0, 0)])
      expect(yield* fallingBlockTick(store, { changed: [chunkCoord(0, 0)], removed: [] })).toBe(0)

      expect(yield* gameplay.drain).toStrictEqual({ changed: [], removed: [] })
      expect(yield* renderer.drain).toStrictEqual({ changed: [], removed: [] })
      // An idle tick is not "a scan that finds nothing" — the rule is never
      // asked, because there is nothing in the batch to ask it about.
      expect(yield* fallingBlockTick(store, { changed: [], removed: [] })).toBe(0)
    }).pipe(Effect.provide(ChunkStoreLayer(slabSource))),
  )

  it.effect('the rule reads a capability, never a block name', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      const subscription = yield* store.subscribeDirty
      yield* store.load(chunkCoord(0, 0))
      yield* subscription.drain

      // Replace the sand with gravel — a DIFFERENT block that carries the same
      // capability — and the rule behaves identically without being told.
      yield* store.setBlock(blockPosition(2, SAND_Y, 3), BLOCK.GRAVEL)
      yield* store.setBlock(blockPosition(2, SUPPORT_Y, 3), BLOCK.AIR)

      const moved = yield* fallingBlockTick(store, yield* subscription.drain)
      expect(moved).toBe(1)
      expect(yield* store.getBlock(blockPosition(2, SUPPORT_Y, 3))).toStrictEqual({
        _tag: 'Block',
        block: BLOCK.GRAVEL,
      })
    }).pipe(Effect.provide(ChunkStoreLayer(slabSource))),
  )

  it.effect('REGRESSION: sand does not fall into an unloaded chunk', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      const subscription = yield* store.subscribeDirty
      yield* store.load(chunkCoord(0, 0))
      yield* subscription.drain

      // Break the support, then unload the chunk below the rule's feet — the
      // shape of a streaming world where the player walked away.
      yield* store.setBlock(blockPosition(2, SUPPORT_Y, 3), BLOCK.AIR)
      const batch = yield* subscription.drain
      yield* store.unload(chunkCoord(0, 0))

      // The rule reads `ChunkNotLoaded`, which is not air, and declines to move
      // anything. With a two-valued read that returned an AIR sentinel — the
      // reading mc-meshing correctly uses for DRAWING — the sand would have
      // fallen out of the world.
      expect(yield* fallingBlockTick(store, batch)).toBe(0)
    }).pipe(Effect.provide(ChunkStoreLayer(slabSource))),
  )

  it.effect('a cascade settles one cell per tick, and stops on its own', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      const subscription = yield* store.subscribeDirty
      yield* store.load(chunkCoord(0, 0))

      // A three-block sand column with an air gap beneath it, at (5, 5).
      for (let y = SAND_Y + 1; y <= SAND_Y + 3; y += 1) {
        yield* store.setBlock(blockPosition(5, y, 5), BLOCK.SAND)
      }
      yield* subscription.drain

      // Kick it off by mining the ground under the gap, then run until quiet.
      // The loop terminates because a settled column produces no further work,
      // not because the loop counts to something.
      yield* store.setBlock(blockPosition(5, SUPPORT_Y, 5), BLOCK.AIR)

      let ticks = 0
      let totalMoved = 0
      for (;;) {
        const batch = yield* subscription.drain
        if (batch.changed.length === 0) {
          break
        }
        const moved = yield* fallingBlockTick(store, batch)
        totalMoved += moved
        ticks += 1
        if (moved === 0 || ticks > 16) {
          break
        }
      }

      expect(ticks).toBeLessThanOrEqual(16)
      expect(totalMoved).toBeGreaterThan(0)

      // The column has come to rest on the stone at SUPPORT_Y - 1.
      expect(yield* store.getBlock(blockPosition(5, SUPPORT_Y, 5))).toStrictEqual({
        _tag: 'Block',
        block: BLOCK.SAND,
      })
      expect(yield* store.getBlock(blockPosition(5, SAND_Y + 3, 5))).toStrictEqual({
        _tag: 'Block',
        block: BLOCK.AIR,
      })
    }).pipe(Effect.provide(ChunkStoreLayer(slabSource))),
  )
})
