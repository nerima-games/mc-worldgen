/**
 * The chunk store, as a VALUE: which chunks are resident, and what each
 * subscriber has not been told about yet.
 *
 * This module holds no `Ref` and runs no `Effect`. Every transition is a pure
 * function returning `[result, nextState]` — the shape `Ref.modify` wants — for
 * the same reason `domain/inventory.ts` in mc-sim does: the whole read-modify-
 * write must be ONE atomic step, and plan.md §3.8 lists TOCTOU on a `Ref` among
 * the reference implementation's recurring Effect-level mistakes. Splitting a
 * write into "read the chunk" then "put it back" loses one of two concurrent
 * mining events, which is an item that never enters an inventory.
 *
 * The service that owns the `Ref` is `application/chunk-store.ts`.
 *
 * ---------------------------------------------------------------------------
 * ONE deliberate impurity: the block buffer is mutated in place
 * ---------------------------------------------------------------------------
 *
 * `withBlockAt` writes into the existing `Uint8Array` rather than producing a
 * copy. A chunk buffer is 16 × 16 × 256 = 65,536 bytes; a copy per block write
 * would mean 2 MB of allocation and copying for one tick of the falling-block
 * budget (`FALLING_BLOCK_MOVES_PER_TICK = 32` in mx-gameplay), for a mutation
 * of one byte. The reference implementation mutates in place for exactly this
 * reason, and plan.md §5.2 sanctions this class of measured exception.
 *
 * The consequence is stated rather than hidden: **a `Chunk` handed out by this
 * store is a live view, not a snapshot.** `chunkSnapshotOf` exists for callers
 * that need a value that will not change under them. `test/chunk-store.test.ts`
 * pins both behaviours, so nobody has to discover the aliasing from a bug.
 *
 * What is NOT mutated in place is the bookkeeping: `loaded` and `subscribers`
 * are replaced wholesale on every transition, so the atomicity argument above
 * still holds for everything the `Ref` actually guards.
 */
import { getBlockAt, setBlockAt, type Chunk } from './chunk'
import { blockIndex, CHUNK_HEIGHT } from './constants'
import { computeChunkLight, getLightAt, type ChunkLight } from './light'
import {
  BlockId,
  chunkCoord,
  chunkCoordOfBlock,
  localCoordOfBlock,
  type BlockPosition,
  type ChunkCoord,
} from './kernel-vocabulary'

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * A `ChunkCoord` flattened to something a `Map` can key on.
 *
 * `Map` keys structurally-shaped objects by reference, so two `chunkCoord(0, 0)`
 * values are two different keys. A string key is the smallest fix that keeps
 * the store a plain `Map`; the reference implementation reached the same shape
 * (`coordKey`). `chunkCoord` normalises `-0` to `0`, which is what stops
 * `"-0,3"` and `"0,3"` naming one chunk twice.
 */
export type ChunkKey = string & { readonly _tag: 'ChunkKey' }

export const chunkKeyOf = (coord: ChunkCoord): ChunkKey => `${coord.cx},${coord.cz}` as ChunkKey

/**
 * Inverse of `chunkKeyOf`. Total: a key this module did not produce yields
 * `chunkCoord(0, 0)` rather than failing, because the only way to obtain a
 * `ChunkKey` is from `chunkKeyOf` and a caller therefore cannot reach the
 * fallback without a cast.
 */
export const chunkCoordOfKey = (key: ChunkKey): ChunkCoord => {
  const [cx, cz] = key.split(',')
  return chunkCoord(Number(cx ?? 0), Number(cz ?? 0))
}

// ---------------------------------------------------------------------------
// Reads and writes
// ---------------------------------------------------------------------------

/**
 * The answer to "what block is at this world position".
 *
 * A three-way answer rather than a number, because "air" and "I do not know"
 * are different facts and conflating them is a bug with a name: sand at the
 * edge of the loaded area, told that the cell below it is air, falls into
 * ungenerated space. mc-meshing deliberately DOES conflate them (its
 * out-of-bounds sentinel is `AIR`, so an unloaded neighbour meshes as open sky
 * rather than as a black wall) — that is correct for drawing and wrong for
 * simulating, which is why the two reads are different functions in different
 * repositories rather than one shared one.
 *
 * The two non-`Block` cases are module-level singletons, so a read that finds
 * nothing allocates nothing.
 */
export type BlockReading =
  | { readonly _tag: 'Block'; readonly block: BlockId }
  | { readonly _tag: 'ChunkNotLoaded' }
  | { readonly _tag: 'OutOfWorld' }

export const CHUNK_NOT_LOADED: BlockReading = { _tag: 'ChunkNotLoaded' }
export const OUT_OF_WORLD: BlockReading = { _tag: 'OutOfWorld' }

export const blockReading = (block: BlockId): BlockReading => ({ _tag: 'Block', block })

/**
 * The outcome of a block write.
 *
 * TOTAL — there is no error channel. `StageRegistration.run` has error channel
 * `never` (mc-kernel `domain/frame.ts`, settled as question 3 of that
 * repository's freeze checklist), so a rule that writes a block has nowhere to
 * put a failure and would have to swallow one. A swallowed failure in a mining
 * handler is a block that visually disappears and comes back next frame.
 *
 * `Unchanged` is a distinct outcome from `Written` and does NOT dirty the
 * chunk. Re-placing the block that is already there is a legal thing for a rule
 * to do (a fluid re-asserting its level, a redstone tick recomputing to the
 * same state), and treating it as a change would remesh the chunk every tick
 * forever.
 */
export type BlockWriteOutcome =
  | { readonly _tag: 'Written'; readonly previous: BlockId; readonly chunk: ChunkCoord }
  | { readonly _tag: 'Unchanged'; readonly previous: BlockId }
  | { readonly _tag: 'ChunkNotLoaded' }
  | { readonly _tag: 'OutOfWorld' }

export const WRITE_CHUNK_NOT_LOADED: BlockWriteOutcome = { _tag: 'ChunkNotLoaded' }
export const WRITE_OUT_OF_WORLD: BlockWriteOutcome = { _tag: 'OutOfWorld' }

/** Convenience for the common "did anything actually change" question. */
export const wasWritten = (outcome: BlockWriteOutcome): boolean => outcome._tag === 'Written'

/** Is this Y inside the world column a chunk represents? */
export const isWorldY = (y: number): boolean => Number.isInteger(y) && y >= 0 && y < CHUNK_HEIGHT

// ---------------------------------------------------------------------------
// Light
// ---------------------------------------------------------------------------

/**
 * The answer to "how bright is this world position".
 *
 * THREE-VALUED, and the two non-`Light` cases are `blockAt`'s, character for
 * character. That symmetry is deliberate: a caller that has already handled
 * `ChunkNotLoaded` and `OutOfWorld` for a block read handles them the same way
 * for a light read, and a caller that has not is stopped by the compiler in both
 * places at once.
 *
 * IT MATTERS MORE HERE THAN IT DOES FOR BLOCKS. `mx-gameplay`'s spawn rule
 * refuses a candidate whose light is not a number (`unmeasurable`), and its
 * comment records why: `NaN > 7` is `false`, so an unmeasured light level that
 * arrived as a bare number would read as PITCH DARK and spawn a hostile in
 * daylight. A `LightReading` that could not express "I do not know" would force
 * every caller to pick a number for that case, and 0 is the number they would
 * pick.
 *
 * The two absent cases are module-level singletons, so a read that finds nothing
 * allocates nothing.
 */
export type LightReading =
  | { readonly _tag: 'Light'; readonly sky: number; readonly block: number }
  | { readonly _tag: 'ChunkNotLoaded' }
  | { readonly _tag: 'OutOfWorld' }

export const LIGHT_CHUNK_NOT_LOADED: LightReading = { _tag: 'ChunkNotLoaded' }
export const LIGHT_OUT_OF_WORLD: LightReading = { _tag: 'OutOfWorld' }

export const lightReading = (sky: number, block: number): LightReading => ({ _tag: 'Light', sky, block })

// ---------------------------------------------------------------------------
// The dirty channel
// ---------------------------------------------------------------------------

/**
 * Identifies one independent reader of the dirty channel.
 *
 * Ids are per-store and monotonic. They are never reused, so a stale
 * `unsubscribe` cannot detach a later subscriber that happened to get the same
 * number.
 */
export type SubscriberId = number & { readonly _tag: 'SubscriberId' }

/**
 * What one subscriber has not been told yet.
 *
 * SETS, not queues, and this is the whole design.
 *
 * A falling sand column dirties one chunk once per move, up to 32 times in a
 * tick under mx-gameplay's `FALLING_BLOCK_MOVES_PER_TICK`. A stream or a
 * `PubSub` delivers 32 messages and the renderer meshes the chunk 32 times; a
 * set delivers one coordinate and the renderer meshes it once. De-duplication
 * is not an optimisation here, it is the difference between the chunk-sync
 * stage costing O(changes) and costing O(1) per changed chunk.
 *
 * `removed` is tracked separately from `changed` because the two demand
 * opposite actions from mc-render: mesh it, versus dispose its
 * `BufferGeometry` (which THREE requires explicitly — mc-render's
 * docs/public-api.md §3.3). A chunk that is changed and then unloaded in the
 * same window appears only in `removed`, and vice versa; the transitions below
 * enforce that, so a subscriber never has to reconcile a contradiction.
 */
export type DirtySubscriberState = {
  readonly changed: ReadonlySet<ChunkKey>
  readonly removed: ReadonlySet<ChunkKey>
}

const EMPTY_SUBSCRIBER: DirtySubscriberState = { changed: new Set(), removed: new Set() }

/** One drain's worth of news, in coordinates the caller can use directly. */
export type ChunkDirtyBatch = {
  readonly changed: ReadonlyArray<ChunkCoord>
  readonly removed: ReadonlyArray<ChunkCoord>
}

export const EMPTY_DIRTY_BATCH: ChunkDirtyBatch = { changed: [], removed: [] }

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

export type ChunkStoreState = {
  readonly loaded: ReadonlyMap<ChunkKey, Chunk>
  /**
   * Computed light, per resident chunk. ABSENT MEANS STALE, not dark.
   *
   * -------------------------------------------------------------------------
   * Why the grids are here and not on `Chunk`
   * -------------------------------------------------------------------------
   *
   * plan.md §3.7 calls the light grid 「チャンクデータの一部」, which is a claim
   * about who OWNS it — this repository, rather than mc-render — and both
   * placements satisfy that. The store-side map wins on two counts:
   *
   *  1. **A stale grid is unreachable.** `load` and `peek` hand out LIVE chunks
   *     (see the module header on aliasing). A `Chunk.skyLight` field would
   *     therefore be readable by every consumer that holds a chunk, including
   *     immediately after somebody else's `setBlock` invalidated it — and a
   *     stale light level is indistinguishable from a fresh one. Keeping the
   *     grids behind the `Ref` means every read goes through `lightAt`, which is
   *     the one place staleness can be noticed and resolved.
   *  2. **`chunkSnapshotOf` stays cheap.** A snapshot copies the block buffer;
   *     with light on the chunk it would copy 64 KB more, for a caller (a save
   *     writer, a worker message, a test assertion) that does not want it. The
   *     reference does not persist light at all — it recomputes on load,
   *     `chunk-manager-ops-storage.ts:61` — so the save path is exactly the
   *     caller that would pay for the copy and throw the result away.
   *
   * The cost of the choice is that light is not part of the value `snapshot`
   * returns, so a consumer that wants both asks twice. That is the correct shape
   * anyway: `getLight` answers about a POSITION, and the grid is an
   * implementation of that answer rather than a thing to hand out.
   */
  readonly lights: ReadonlyMap<ChunkKey, ChunkLight>
  readonly subscribers: ReadonlyMap<SubscriberId, DirtySubscriberState>
  readonly nextSubscriberId: number
}

export const emptyChunkStoreState: ChunkStoreState = {
  loaded: new Map(),
  lights: new Map(),
  subscribers: new Map(),
  nextSubscriberId: 0,
}

/**
 * Forget one chunk's light. THE WHOLE OF INVALIDATION, and it is O(1).
 *
 * -------------------------------------------------------------------------
 * Lazy, not eager, and here is the number
 * -------------------------------------------------------------------------
 *
 * The alternative is to relight on the spot inside `withBlockAt`. It was
 * rejected on a measurement rather than a preference: `computeChunkLight` reads
 * `CHUNK_VOLUME` = 65,536 cells twice and then walks the lit volume, and
 * mx-gameplay's `FALLING_BLOCK_MOVES_PER_TICK` is 32. Eager recompute would
 * therefore cost upwards of four million cell visits per tick to service a
 * column of falling sand — which is DN-GP-1's mistake exactly, the reference's
 * ~7M block reads per maintenance tick that plan.md §3.11 records as ~40% of the
 * main thread.
 *
 * Dropping the entry costs one `Map` delete. N writes to one chunk followed by
 * one light read cost ONE relight rather than N, and a chunk nobody asks about
 * is never lit at all — so a world being mined by a player who is not looking at
 * the sky pays nothing.
 *
 * What the caller pays instead is a LATENCY SPIKE on the first `getLight` after
 * a write: one whole-chunk relight, on the frame that asked. That is acceptable
 * because the only consumer today is a spawn search that runs on a cadence
 * (the reference's is every 0.3s) rather than per frame per cell, and it is the
 * exact cost the incremental two-queue engine in `./light`'s header removes.
 *
 * Returns the SAME map when there was nothing to forget, so a write to a chunk
 * whose light was never computed allocates nothing.
 */
const withoutLight = (
  lights: ReadonlyMap<ChunkKey, ChunkLight>,
  key: ChunkKey,
): ReadonlyMap<ChunkKey, ChunkLight> => {
  if (!lights.has(key)) {
    return lights
  }

  const next = new Map(lights)
  next.delete(key)
  return next
}

/**
 * Record a change against every subscriber at once.
 *
 * Cost is O(subscribers), and the subscriber count is a small constant — the
 * chunk-sync stage, the falling-block rule, redstone, autosave. It is NOT
 * O(loaded chunks), which is the property that matters: mc-render's
 * docs/public-api.md §3.3 rejects a pull design on the grounds that scanning
 * every chunk every frame is the same O(chunks × blocks) mistake plan.md §3.11
 * records for falling blocks.
 *
 * This channel is a pull with per-subscriber accumulation, which has push's
 * cost profile without requiring the store to know its consumers. That
 * distinction is not stylistic: mc-worldgen cannot import mc-sim or mc-render
 * (both edges are cycles), so a design in which the store CALLS its consumers
 * is not available to it.
 */
const noteChange = (
  subscribers: ReadonlyMap<SubscriberId, DirtySubscriberState>,
  key: ChunkKey,
  kind: 'changed' | 'removed',
): ReadonlyMap<SubscriberId, DirtySubscriberState> => {
  const next = new Map<SubscriberId, DirtySubscriberState>()

  for (const [id, state] of subscribers) {
    const changed = new Set(state.changed)
    const removed = new Set(state.removed)

    if (kind === 'changed') {
      // A chunk that comes back after being unloaded is a change, not a
      // removal — and it must not be reported as both.
      removed.delete(key)
      changed.add(key)
    } else {
      changed.delete(key)
      removed.add(key)
    }

    next.set(id, { changed, removed })
  }

  return next
}

/**
 * Make a chunk resident, and tell everyone.
 *
 * Idempotent in the sense that matters: loading a chunk that is already
 * resident REPLACES it, because the only caller that does so is a reload from
 * storage. Both the replacement and a first load count as a change, since a
 * subscriber cannot tell the difference and both require a remesh.
 */
export const withChunk = (state: ChunkStoreState, chunk: Chunk): ChunkStoreState => {
  const key = chunkKeyOf(chunk.coord)
  const loaded = new Map(state.loaded)
  loaded.set(key, chunk)

  return {
    loaded,
    // A REPLACED chunk is a different world in the same place, so its cached
    // light describes blocks that are gone. Dropping it here is what makes the
    // reload path (storage, or a regenerated chunk) safe without the caller
    // having to remember; leaving it would light a chunk from storage with the
    // grid of whatever used to be resident at that coordinate.
    lights: withoutLight(state.lights, key),
    subscribers: noteChange(state.subscribers, key, 'changed'),
    nextSubscriberId: state.nextSubscriberId,
  }
}

/**
 * Drop a chunk. Resolves to whether anything was actually resident, so a caller
 * can tell "unloaded it" from "there was nothing to unload".
 *
 * NOTE what this does not do: persist. plan.md §3.7 gives this repository the
 * chunk save FORMAT (`defineFormat`, via mc-save) and the reference's
 * `unloadChunk` fails with `StorageError` for that reason. mc-save is not
 * consumable yet (plan.md §6 Step 3), so unload currently drops. The seam is
 * `ChunkSource` in `application/chunk-store.ts`; see docs/public-api.md.
 */
export const withoutChunk = (state: ChunkStoreState, coord: ChunkCoord): readonly [boolean, ChunkStoreState] => {
  const key = chunkKeyOf(coord)

  if (!state.loaded.has(key)) {
    return [false, state]
  }

  const loaded = new Map(state.loaded)
  loaded.delete(key)

  return [
    true,
    {
      loaded,
      // Not merely invalidated — the chunk is gone, so a grid kept here would be
      // a leak keyed by a coordinate nothing can reach.
      lights: withoutLight(state.lights, key),
      subscribers: noteChange(state.subscribers, key, 'removed'),
      nextSubscriberId: state.nextSubscriberId,
    },
  ]
}

/** Read one block. Never fails, never generates. */
export const blockAt = (state: ChunkStoreState, position: BlockPosition): BlockReading => {
  if (!isWorldY(position.y)) {
    return OUT_OF_WORLD
  }

  const chunk = state.loaded.get(chunkKeyOf(chunkCoordOfBlock(position)))
  if (chunk === undefined) {
    return CHUNK_NOT_LOADED
  }

  const local = localCoordOfBlock(position)
  return blockReading(BlockId(getBlockAt(chunk, local.lx, local.ly, local.lz)))
}

/**
 * Write one block, and dirty its chunk if anything changed.
 *
 * The buffer write is in place (see the module header). The subscriber
 * bookkeeping is not, which is what keeps this a single atomic transition from
 * `Ref.modify`'s point of view.
 */
export const withBlockAt = (
  state: ChunkStoreState,
  position: BlockPosition,
  block: BlockId,
): readonly [BlockWriteOutcome, ChunkStoreState] => {
  if (!isWorldY(position.y)) {
    return [WRITE_OUT_OF_WORLD, state]
  }

  const coord = chunkCoordOfBlock(position)
  const key = chunkKeyOf(coord)
  const chunk = state.loaded.get(key)

  if (chunk === undefined) {
    return [WRITE_CHUNK_NOT_LOADED, state]
  }

  const local = localCoordOfBlock(position)
  const previous = BlockId(getBlockAt(chunk, local.lx, local.ly, local.lz))

  if (previous === block) {
    return [{ _tag: 'Unchanged', previous }, state]
  }

  setBlockAt(chunk.blocks, local.lx, local.ly, local.lz, block)

  return [
    { _tag: 'Written', previous, chunk: coord },
    {
      loaded: state.loaded,
      // THE INVALIDATION `application/chunk-store.ts`'s HEADER IS AN ARGUMENT
      // ABOUT. That header settles the whole block-write path in this repository
      // partly on the grounds that 「a block write invalidates light」; a write
      // that left the grid standing would make the sentence false and would hand
      // the next `getLight` the brightness of a wall that has just been mined
      // through.
      //
      // It hangs off the `Written` branch and not off the function, which is the
      // same rule the dirty channel follows two lines down: `Unchanged` re-places
      // the block that was already there, so the light it would recompute is the
      // light that is already cached. Invalidating there would relight a chunk
      // every tick for a fluid re-asserting its own level.
      lights: withoutLight(state.lights, key),
      subscribers: noteChange(state.subscribers, key, 'changed'),
      nextSubscriberId: state.nextSubscriberId,
    },
  ]
}

/**
 * Read the light at one world position, computing this chunk's grids if they
 * are not cached.
 *
 * Returns `[reading, nextState]` — the `Ref.modify` shape — rather than a bare
 * reading, and that is the only reason this function is not a plain query. The
 * relight has to be published back into the state or every read after a write
 * would recompute the same chunk again; doing it as read-then-write in the
 * application layer would be the TOCTOU split plan.md §3.8 lists among the
 * reference's recurring Effect-level mistakes, with two fibers each lighting the
 * chunk and one of the two grids discarded.
 *
 * NOTHING IS RECOMPUTED WHEN THE ENTRY IS PRESENT, so the state comes back by
 * reference on the common path and `Ref.modify` writes the value it read.
 */
export const lightAt = (
  state: ChunkStoreState,
  position: BlockPosition,
): readonly [LightReading, ChunkStoreState] => {
  if (!isWorldY(position.y)) {
    return [LIGHT_OUT_OF_WORLD, state]
  }

  const coord = chunkCoordOfBlock(position)
  const key = chunkKeyOf(coord)
  const chunk = state.loaded.get(key)

  if (chunk === undefined) {
    // NOT "dark". See `LightReading`: a caller that cannot tell an unlit cell
    // from an unloaded one spawns hostiles at the edge of the loaded area.
    return [LIGHT_CHUNK_NOT_LOADED, state]
  }

  const local = localCoordOfBlock(position)
  const voxel = blockIndex(local.lx, local.ly, local.lz)
  const cached = state.lights.get(key)

  if (cached !== undefined) {
    return [lightReading(getLightAt(cached.sky, voxel), getLightAt(cached.block, voxel)), state]
  }

  const computed = computeChunkLight(chunk)
  const lights = new Map(state.lights)
  lights.set(key, computed)

  return [
    lightReading(getLightAt(computed.sky, voxel), getLightAt(computed.block, voxel)),
    {
      loaded: state.loaded,
      lights,
      subscribers: state.subscribers,
      nextSubscriberId: state.nextSubscriberId,
    },
  ]
}

/**
 * Register a new reader of the dirty channel.
 *
 * A fresh subscriber starts EMPTY rather than pre-loaded with every resident
 * chunk. Subscribing is not a request for a full resync: mc-render's world
 * renderer is built by loading chunks and meshing them, and handing it the
 * whole world again on subscribe would mesh everything twice. A caller that
 * does want a resync has `loadedCoords`.
 */
export const subscribed = (state: ChunkStoreState): readonly [SubscriberId, ChunkStoreState] => {
  const id = state.nextSubscriberId as SubscriberId
  const subscribers = new Map(state.subscribers)
  subscribers.set(id, EMPTY_SUBSCRIBER)

  return [
    id,
    {
      loaded: state.loaded,
      lights: state.lights,
      subscribers,
      nextSubscriberId: state.nextSubscriberId + 1,
    },
  ]
}

/** Detach a reader. Its pending set is discarded, and its id is never reissued. */
export const unsubscribed = (state: ChunkStoreState, id: SubscriberId): ChunkStoreState => {
  if (!state.subscribers.has(id)) {
    return state
  }

  const subscribers = new Map(state.subscribers)
  subscribers.delete(id)

  return { loaded: state.loaded, lights: state.lights, subscribers, nextSubscriberId: state.nextSubscriberId }
}

/**
 * "Which chunks changed since I last looked" — take one subscriber's pending
 * sets and clear them.
 *
 * Cost is O(that subscriber's pending), never O(loaded). An idle world drains
 * an empty batch and allocates two empty arrays, which is the property the
 * reference implementation's every-chunk sweep lacked
 * (`falling-block-maintenance.ts:9-15`: ~7M block reads per maintenance tick,
 * ~40% of the main thread while exploring).
 *
 * Draining an unknown id yields an empty batch rather than failing, so a
 * subscriber that outlives a `reset` degrades to "sees nothing" instead of
 * crashing a frame.
 */
export const drained = (
  state: ChunkStoreState,
  id: SubscriberId,
): readonly [ChunkDirtyBatch, ChunkStoreState] => {
  const pending = state.subscribers.get(id)

  if (pending === undefined || (pending.changed.size === 0 && pending.removed.size === 0)) {
    return [EMPTY_DIRTY_BATCH, state]
  }

  const batch: ChunkDirtyBatch = {
    changed: [...pending.changed].map(chunkCoordOfKey),
    removed: [...pending.removed].map(chunkCoordOfKey),
  }

  const subscribers = new Map(state.subscribers)
  subscribers.set(id, EMPTY_SUBSCRIBER)

  return [
    batch,
    { loaded: state.loaded, lights: state.lights, subscribers, nextSubscriberId: state.nextSubscriberId },
  ]
}

/** Look without loading. The returned chunk is a LIVE view — see the header. */
export const residentChunk = (state: ChunkStoreState, coord: ChunkCoord): Chunk | undefined =>
  state.loaded.get(chunkKeyOf(coord))

export const residentCoords = (state: ChunkStoreState): ReadonlyArray<ChunkCoord> =>
  [...state.loaded.values()].map((chunk) => chunk.coord)

/**
 * A detached copy, for a caller that needs a chunk that will not change under
 * it — a save writer, a worker message, an assertion in a test.
 */
export const chunkSnapshotOf = (chunk: Chunk): Chunk => ({
  coord: chunk.coord,
  blocks: chunk.blocks.slice(),
  biomes: [...chunk.biomes],
})

/**
 * The four horizontal neighbours of a chunk, for boundary faces.
 *
 * Shaped to satisfy mc-meshing's `ChunkNeighbours` STRUCTURALLY (its
 * `domain/chunk-view.ts`: four optional `{ blocks }` values, `yPos`/`yNeg`
 * absent because chunks are full-height columns). mc-worldgen must not import
 * mc-meshing — that edge is not in plan.md §2.1's graph and `pnpm check:deps`
 * rejects it — so the compatibility is structural rather than nominal, and
 * mc-render, which depends on both, passes the result straight through.
 *
 * This closes the gap the vertical-slice spike found: meshing has no coordinate
 * vocabulary at all, so `ChunkNeighbours` could not be populated from a
 * coordinate-keyed store without the caller doing four lookups by hand. The
 * lookups belong to whoever owns the keys, which is this module.
 *
 * A missing neighbour is left ABSENT rather than set to `undefined`, because
 * `exactOptionalPropertyTypes` makes those different types.
 */
export type ChunkNeighbours = {
  readonly xPos?: Chunk
  readonly xNeg?: Chunk
  readonly zPos?: Chunk
  readonly zNeg?: Chunk
}

export const neighboursOf = (state: ChunkStoreState, coord: ChunkCoord): ChunkNeighbours => {
  const xPos = residentChunk(state, chunkCoord(coord.cx + 1, coord.cz))
  const xNeg = residentChunk(state, chunkCoord(coord.cx - 1, coord.cz))
  const zPos = residentChunk(state, chunkCoord(coord.cx, coord.cz + 1))
  const zNeg = residentChunk(state, chunkCoord(coord.cx, coord.cz - 1))

  return {
    ...(xPos === undefined ? {} : { xPos }),
    ...(xNeg === undefined ? {} : { xNeg }),
    ...(zPos === undefined ? {} : { zPos }),
    ...(zNeg === undefined ? {} : { zNeg }),
  }
}
