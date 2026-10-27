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
 * `withBlockAt` writes into the existing `Uint16Array` rather than producing a
 * copy. A chunk buffer is 16 × 16 × 256 = 65,536 elements (131,072 bytes); a
 * copy per block write would mean 4 MB of allocation and copying for one tick
 * of the falling-block budget (`FALLING_BLOCK_MOVES_PER_TICK = 32` in
 * mx-gameplay), for a mutation of one element. The reference implementation
 * mutates in place for exactly this reason, and plan.md §5.2 sanctions this
 * class of measured exception.
 *
 * The store's public write path does not use that helper: transaction
 * preparation copies each changed chunk and publication swaps the chunk map.
 * A store write therefore does not change a chunk already returned by
 * `load` or `peek`. `chunkSnapshotOf` still gives a detached copy to callers
 * that need ownership of its buffer.
 *
 * What is NOT mutated in place is the bookkeeping: `loaded` and `subscribers`
 * are replaced wholesale on every transition, so the atomicity argument above
 * still holds for everything the `Ref` actually guards.
 */
import {
  BlockAxis,
  BlockId,
  type BlockPosition,
  ChunkAxis,
  type ChunkCoord,
  type ChunkKey,
  type LocalBlockCoord,
  chunkCoord,
  chunkCoordOfBlock,
  chunkKeyOf,
  localCoordOfBlock,
} from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, blockIndex } from './constants.js'
import { type Chunk, getBlockAt, setBlockAt } from './chunk.js'
import { type ChunkLight, computeChunkLights, getLightAt, updateChunkLights } from './light.js'
import { Option } from 'effect'
import { chunkAxisFromKnownSafeInteger } from './coordinate-compatibility.js'

export { chunkKeyOf } from '@nerima-games/mc-kernel'

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


export type ChunkBlockEdit = Readonly<{
  readonly position: BlockPosition
  readonly block: BlockId
}>

export type ChunkBlockChange = Readonly<{
  readonly position: BlockPosition
  readonly previous: BlockId
  readonly next: BlockId
}>

export type ChunkWriteInvalidBatch = Readonly<{
  readonly _tag: 'ChunkWriteInvalidBatch'
  readonly reason:
    | 'empty'
    | 'not-array'
    | 'invalid-edit'
    | 'invalid-position'
    | 'invalid-block-id'
    | 'duplicate-position'
    | 'out-of-world'
}>

export type ChunkWriteChunkUnavailable = Readonly<{
  readonly _tag: 'ChunkWriteChunkUnavailable'
  readonly position: BlockPosition
}>

export type ChunkWritePrepareError = ChunkWriteInvalidBatch | ChunkWriteChunkUnavailable

export type ChunkWriteStale = Readonly<{
  readonly _tag: 'ChunkWriteStale'
  readonly key: ChunkKey
  readonly expectedRevision: number
  readonly actualRevision?: number
}>

export type ChunkWriteTokenInvalid = Readonly<{
  readonly _tag: 'ChunkWriteTokenInvalid'
  readonly reason: 'foreign_store' | 'already_published' | 'unknown_token'
}>

export type ChunkWritePublishError = ChunkWriteStale | ChunkWriteTokenInvalid

const preparedChunkWriteBrand: unique symbol = Symbol('PreparedChunkWrite')

export type PreparedChunkWrite = Readonly<{
  readonly [preparedChunkWriteBrand]: true
  readonly changes: ReadonlyArray<ChunkBlockChange>
}>

export type PreparedChunkWriteCandidate = Readonly<{
  readonly prepared: PreparedChunkWrite
  readonly baseRevisions: ReadonlyMap<ChunkKey, number>
  readonly chunks: ReadonlyMap<ChunkKey, Chunk>
  readonly changedBlocks: ReadonlyArray<Readonly<{
    readonly key: ChunkKey
    readonly coord: ChunkCoord
    readonly local: LocalBlockCoord
  }>>
  readonly changedChunks: ReadonlyArray<Readonly<{
    readonly key: ChunkKey
    readonly coord: ChunkCoord
  }>>
}>

export type ChunkWritePreparation =
  | Readonly<{ readonly _tag: 'Prepared'; readonly candidate: PreparedChunkWriteCandidate }>
  | Readonly<{ readonly _tag: 'Rejected'; readonly error: ChunkWritePrepareError }>

export type SingleChunkWritePreparation =
  | Readonly<{
      readonly _tag: 'Prepared'
      readonly candidate: PreparedChunkWriteCandidate
      readonly outcome: Extract<BlockWriteOutcome, { readonly _tag: 'Written' | 'Unchanged' }>
    }>
  | Readonly<{
      readonly _tag: 'Rejected'
      readonly outcome: Extract<BlockWriteOutcome, { readonly _tag: 'ChunkNotLoaded' | 'OutOfWorld' }>
    }>

export const WRITE_CHUNK_NOT_LOADED: BlockWriteOutcome = { _tag: 'ChunkNotLoaded' }
export const WRITE_OUT_OF_WORLD: BlockWriteOutcome = { _tag: 'OutOfWorld' }

/** Convenience for the common "did anything actually change" question. */
export const wasWritten = (outcome: BlockWriteOutcome): boolean => outcome['_tag'] === 'Written'

/** The lowest Y a chunk column represents. */
const WORLD_MIN_Y = 0

/** Is this Y inside the world column a chunk represents? */
export const isWorldY = (y: BlockAxis): boolean => y >= WORLD_MIN_Y && y < CHUNK_HEIGHT

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

export const lightReading = (sky: number, block: number): LightReading => ({ _tag: 'Light', block, sky })

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
export type SubscriberId = number

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
  readonly changed: ReadonlyMap<ChunkKey, ChunkCoord>
  readonly removed: ReadonlyMap<ChunkKey, ChunkCoord>
}

const EMPTY_SUBSCRIBER: DirtySubscriberState = { changed: new Map(), removed: new Map() }

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
  /** Revisions for resident chunks only. */
  readonly revisions: ReadonlyMap<ChunkKey, number>
  /** Monotonic across writes, residency transitions, and reset. */
  readonly revisionClock: number
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

/** A chunk has no current revision before it becomes resident. */
const INITIAL_CHUNK_REVISION = 0
/** Every write or residency transition advances the store's revision clock once. */
const CHUNK_REVISION_STEP = 1
const NO_CHANGES = 0

export const emptyChunkStoreState: ChunkStoreState = {
  lights: new Map(),
  loaded: new Map(),
  nextSubscriberId: 0,
  revisionClock: INITIAL_CHUNK_REVISION,
  revisions: new Map(),
  subscribers: new Map(),
}

const incrementChunkRevisions = (
  state: ChunkStoreState,
  keys: ReadonlyArray<ChunkKey>,
): Readonly<{ readonly revisions: ReadonlyMap<ChunkKey, number>; readonly revisionClock: number }> => {
  const { revisions: currentRevisions, revisionClock: currentRevisionClock } = state
  const revisions = new Map(currentRevisions)
  let revisionClock = currentRevisionClock
  for (const key of keys) {
    revisionClock += CHUNK_REVISION_STEP
    revisions.set(key, revisionClock)
  }
  return { revisionClock, revisions }
}

const removeChunkRevision = (
  state: ChunkStoreState,
  key: ChunkKey,
): Readonly<{ readonly revisions: ReadonlyMap<ChunkKey, number>; readonly revisionClock: number }> => {
  const { revisions: currentRevisions, revisionClock: currentRevisionClock } = state
  const revisions = new Map(currentRevisions)
  revisions.delete(key)
  return { revisionClock: currentRevisionClock + CHUNK_REVISION_STEP, revisions }
}

/**
 * Forget one chunk's light when the cache is cold or incomplete.
 *
 * -------------------------------------------------------------------------
 * Cold-cache fallback
 * -------------------------------------------------------------------------
 *
 * A complete warm cache is updated by `updateChunkLights` in `withBlockAt`.
 * Until the first light read, or while chunk load/unload has made the cache
 * partial, dropping entries preserves the lazy property: a world nobody asks
 * about pays no lighting cost. The next read rebuilds one mutually consistent
 * set with `computeChunkLights`.
 *
 * Returns the SAME map when there was nothing to forget, so a write to a chunk
 * whose light was never computed allocates nothing.
 */
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
/** One subscriber's pending sets after one chunk is noted `changed` or `removed`. */
const nextDirtySubscriberState = (
  state: DirtySubscriberState,
  key: ChunkKey,
  coord: ChunkCoord,
  kind: 'changed' | 'removed',
): DirtySubscriberState => {
  const changed = new Map(state.changed)
  const removed = new Map(state.removed)

  if (kind === 'changed') {
    // A chunk that comes back after being unloaded is a change, not a
    // Removal — and it must not be reported as both.
    removed.delete(key)
    changed.set(key, coord)
  } else {
    changed.delete(key)
    removed.set(key, coord)
  }

  return { changed, removed }
}

const noteChange = (
  subscribers: ReadonlyMap<SubscriberId, DirtySubscriberState>,
  key: ChunkKey,
  coord: ChunkCoord,
  kind: 'changed' | 'removed',
): ReadonlyMap<SubscriberId, DirtySubscriberState> => {
  const next = new Map<SubscriberId, DirtySubscriberState>()

  for (const [id, state] of subscribers) {
    next.set(id, nextDirtySubscriberState(state, key, coord, kind))
  }

  return next
}

/** The step of one chunk-grid cell; the value shared by every horizontal-neighbour offset below. */
const NEIGHBOUR_OFFSET_STEP = 1
/** No displacement along an axis, for the offset pairs below that only move on one axis. */
const NEIGHBOUR_OFFSET_NONE = 0

const HORIZONTAL_NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [NEIGHBOUR_OFFSET_STEP, NEIGHBOUR_OFFSET_NONE],
  [-NEIGHBOUR_OFFSET_STEP, NEIGHBOUR_OFFSET_NONE],
  [NEIGHBOUR_OFFSET_NONE, NEIGHBOUR_OFFSET_STEP],
  [NEIGHBOUR_OFFSET_NONE, -NEIGHBOUR_OFFSET_STEP],
]

const chunkCoordAtOffset = (coord: ChunkCoord, dcx: number, dcz: number): ChunkCoord | undefined => {
  const cx = ChunkAxis.option(coord.cx + dcx)
  const cz = ChunkAxis.option(coord.cz + dcz)
  if (Option.isNone(cx) || Option.isNone(cz)) {
    return
  }
  return chunkCoord(cx.value, cz.value)
}

const lightKeysAround = (coord: ChunkCoord): ReadonlyArray<ChunkKey> => {
  const keys: Array<ChunkKey> = [chunkKeyOf(coord)]
  for (const [dcx, dcz] of HORIZONTAL_NEIGHBOUR_OFFSETS) {
    const adjacent = chunkCoordAtOffset(coord, dcx, dcz)
    if (adjacent) {
      keys.push(chunkKeyOf(adjacent))
    }
  }
  return keys
}

const withoutLights = (
  lights: ReadonlyMap<ChunkKey, ChunkLight>,
  keys: ReadonlyArray<ChunkKey>,
): ReadonlyMap<ChunkKey, ChunkLight> => {
  if (!keys.some((key) => lights.has(key))) {return lights}
  const next = new Map(lights)
  for (const key of keys) {next.delete(key)}
  return next
}

const hasCompleteLightCache = (state: ChunkStoreState): boolean => {
  if (state.lights.size !== state.loaded.size) {return false}
  return [...state.loaded.keys()].every((key) => state.lights.has(key))
}

/** Mark resident neighbours whose exposed boundary faces changed. */
const noteLoadedNeighbours = (
  subscribers: ReadonlyMap<SubscriberId, DirtySubscriberState>,
  loaded: ReadonlyMap<ChunkKey, Chunk>,
  coord: ChunkCoord,
): ReadonlyMap<SubscriberId, DirtySubscriberState> => {
  let next = subscribers

  for (const [dcx, dcz] of HORIZONTAL_NEIGHBOUR_OFFSETS) {
    const neighbourCoord = chunkCoordAtOffset(coord, dcx, dcz)
    if (neighbourCoord) {
      const key = chunkKeyOf(neighbourCoord)
      if (loaded.has(key)) {
        next = noteChange(next, key, neighbourCoord, 'changed')
      }
    }
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
  const subscribers = noteLoadedNeighbours(
    noteChange(state.subscribers, key, chunk.coord, 'changed'),
    state.loaded,
    chunk.coord,
  )
  const revisions = incrementChunkRevisions(state, [key])

  return {
    // A REPLACED chunk is a different world in the same place, so its cached
    // Light describes blocks that are gone. Dropping it here is what makes the
    // Reload path (storage, or a regenerated chunk) safe without the caller
    // Having to remember; leaving it would light a chunk from storage with the
    // Grid of whatever used to be resident at that coordinate.
    lights: withoutLights(state.lights, lightKeysAround(chunk.coord)),
    loaded,
    nextSubscriberId: state.nextSubscriberId,
    ...revisions,
    subscribers,
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
  const subscribers = noteLoadedNeighbours(
    noteChange(state.subscribers, key, coord, 'removed'),
    loaded,
    coord,
  )
  const revisions = removeChunkRevision(state, key)

  return [
    true,
    {
      // Not merely invalidated — the chunk is gone, so a grid kept here would be
      // A leak keyed by a coordinate nothing can reach.
      lights: withoutLights(state.lights, lightKeysAround(coord)),
      loaded,
      nextSubscriberId: state.nextSubscriberId,
      ...revisions,
      subscribers,
    },
  ]
}

/** One block position resolved to its resident chunk, or absent when nothing is loaded there. */
type LoadedChunkTarget = {
  readonly chunk: Chunk
  readonly coord: ChunkCoord
  readonly key: ChunkKey
  readonly local: LocalBlockCoord
}

const resolveLoadedChunk = (state: ChunkStoreState, position: BlockPosition): LoadedChunkTarget | undefined => {
  const coord = chunkCoordOfBlock(position)
  const key = chunkKeyOf(coord)
  const chunk = state.loaded.get(key)

  if (!chunk) {
    return
  }

  return { chunk, coord, key, local: localCoordOfBlock(position) }
}

/** Read one block. Never fails, never generates. */
export const blockAt = (state: ChunkStoreState, position: BlockPosition): BlockReading => {
  if (!isWorldY(position.y)) {
    return OUT_OF_WORLD
  }

  const target = resolveLoadedChunk(state, position)
  if (!target) {
    return CHUNK_NOT_LOADED
  }

  return blockReading(BlockId(getBlockAt(target.chunk, target.local.lx, target.local.ly, target.local.lz)))
}

/** The width of one chunk-local axis index step, for converting a size into its highest index. */
const CHUNK_LOCAL_INDEX_STEP = 1

/** The edge of a chunk-local axis nearest the origin, and the far edge, in local coordinates. */
const CHUNK_LOCAL_MIN_XZ = 0
const CHUNK_LOCAL_MAX_XZ = CHUNK_SIZE_XZ - CHUNK_LOCAL_INDEX_STEP

/** Every chunk whose cached light needs dropping after a write at `local` within `coord`. */
const affectedLightKeys = (coord: ChunkCoord, local: LocalBlockCoord): ReadonlyArray<ChunkKey> => {
  const keys = [chunkKeyOf(coord)]
  const offsets: ReadonlyArray<readonly [boolean, number, number]> = [
    [local.lx === CHUNK_LOCAL_MIN_XZ, -NEIGHBOUR_OFFSET_STEP, NEIGHBOUR_OFFSET_NONE],
    [local.lx === CHUNK_LOCAL_MAX_XZ, NEIGHBOUR_OFFSET_STEP, NEIGHBOUR_OFFSET_NONE],
    [local.lz === CHUNK_LOCAL_MIN_XZ, NEIGHBOUR_OFFSET_NONE, -NEIGHBOUR_OFFSET_STEP],
    [local.lz === CHUNK_LOCAL_MAX_XZ, NEIGHBOUR_OFFSET_NONE, NEIGHBOUR_OFFSET_STEP],
  ]
  for (const [affected, dcx, dcz] of offsets) {
    if (affected) {
      // This coordinate came from a valid BlockPosition, so its chunk index is far inside ChunkAxis limits.
      keys.push(chunkKeyOf(chunkCoord(
        chunkAxisFromKnownSafeInteger(coord.cx + dcx),
        chunkAxisFromKnownSafeInteger(coord.cz + dcz),
      )))
    }
  }
  return keys
}

/**
 * A complete cache is reconciled immediately by the local fixed-point queue. A
 * cold or partial cache keeps the lazy invalidation path; the next read
 * rebuilds every resident grid together, including seams.
 *
 * Called only from the `Written` branch of `applyBlockWrite`, which is the
 * same rule the dirty channel follows: `Unchanged` re-places the block that
 * was already there, so the light it would recompute is the light that is
 * already cached. Invalidating there would relight a chunk every tick for a
 * fluid re-asserting its own level.
 */
const relightAfterBlockChange = (
  state: ChunkStoreState,
  coord: ChunkCoord,
  local: LocalBlockCoord,
): ReadonlyMap<ChunkKey, ChunkLight> => {
  if (hasCompleteLightCache(state)) {
    return updateChunkLights(state.loaded, state.lights, [
      { coord, x: local.lx, y: local.ly, z: local.lz },
    ])
  }
  return withoutLights(state.lights, affectedLightKeys(coord, local))
}

/** The write itself, once `target` is known to be resident. */
const applyBlockWrite = (
  state: ChunkStoreState,
  target: LoadedChunkTarget,
  block: BlockId,
): readonly [BlockWriteOutcome, ChunkStoreState] => {
  const { chunk, coord, key, local } = target
  const previous = BlockId(getBlockAt(chunk, local.lx, local.ly, local.lz))

  if (previous === block) {
    return [{ _tag: 'Unchanged', previous }, state]
  }

  setBlockAt(chunk.blocks, local.lx, local.ly, local.lz, block)
  const revisions = incrementChunkRevisions(state, [key])

  return [
    { _tag: 'Written', chunk: coord, previous },
    {
      lights: relightAfterBlockChange(state, coord, local),
      loaded: state.loaded,
      nextSubscriberId: state.nextSubscriberId,
      ...revisions,
      subscribers: noteChange(state.subscribers, key, coord, 'changed'),
    },
  ]
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

  const target = resolveLoadedChunk(state, position)
  if (!target) {
    return [WRITE_CHUNK_NOT_LOADED, state]
  }

  return applyBlockWrite(state, target, block)
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
/** The cache-hit or cache-miss tail of `lightAt`, once a resident chunk is known. */
const ORIGIN_COORDINATE = 0

const blockPositionKey = ({ x, y, z }: BlockPosition): string =>
  `${x + ORIGIN_COORDINATE},${y + ORIGIN_COORDINATE},${z + ORIGIN_COORDINATE}`

type ValidatedChunkBlockEdit = Readonly<{
  readonly edit: ChunkBlockEdit
  readonly target: LoadedChunkTarget
}>

type ChunkWriteCandidateBuilder = {
  readonly chunks: Map<ChunkKey, Chunk>
  readonly changes: ChunkBlockChange[]
  readonly changedBlocks: Array<{
    readonly key: ChunkKey
    readonly coord: ChunkCoord
    readonly local: LocalBlockCoord
  }>
  readonly changedChunks: Map<ChunkKey, Readonly<{ readonly key: ChunkKey; readonly coord: ChunkCoord }>>
}

const writableChunkFor = (chunks: Map<ChunkKey, Chunk>, target: LoadedChunkTarget): Chunk => {
  const existing = chunks.get(target.key)
  if (existing) {
    return existing
  }
  const copy = { ...target.chunk, blocks: target.chunk.blocks.slice() }
  chunks.set(target.key, copy)
  return copy
}

const appendChunkWrite = (builder: ChunkWriteCandidateBuilder, { edit, target }: ValidatedChunkBlockEdit): void => {
  const current = builder.chunks.get(target.key) ?? target.chunk
  const previous = BlockId(getBlockAt(current, target.local.lx, target.local.ly, target.local.lz))
  if (previous === edit.block) {
    return
  }

  const next = writableChunkFor(builder.chunks, target)
  setBlockAt(next.blocks, target.local.lx, target.local.ly, target.local.lz, edit.block)
  builder.changes.push(Object.freeze({
    next: edit.block,
    position: Object.freeze({ ...edit.position }),
    previous,
  }))
  builder.changedBlocks.push({ coord: target.coord, key: target.key, local: target.local })
  builder.changedChunks.set(target.key, { coord: target.coord, key: target.key })
}

const preparedCandidateFor = (
  state: ChunkStoreState,
  edits: ReadonlyArray<ValidatedChunkBlockEdit>,
): PreparedChunkWriteCandidate => {
  const builder: ChunkWriteCandidateBuilder = {
    changedBlocks: [],
    changedChunks: new Map(),
    changes: [],
    chunks: new Map(),
  }
  for (const edit of edits) {
    appendChunkWrite(builder, edit)
  }

  const prepared = Object.freeze({
    [preparedChunkWriteBrand]: true as const,
    changes: Object.freeze(builder.changes),
  })
  const changedChunks = Object.freeze([...builder.changedChunks.values()])
  const baseRevisions = new Map<ChunkKey, number>()
  for (const changed of changedChunks) {
    baseRevisions.set(changed.key, state.revisions.get(changed.key) ?? INITIAL_CHUNK_REVISION)
  }

  return {
    baseRevisions,
    changedBlocks: Object.freeze(builder.changedBlocks),
    changedChunks,
    chunks: builder.chunks,
    prepared,
  }
}

type BlockEditValidation =
  | Readonly<{ readonly _tag: 'Valid' }>
  | Readonly<{ readonly _tag: 'Rejected'; readonly error: ChunkWritePrepareError }>

const invalidBatch = (reason: ChunkWriteInvalidBatch['reason']): BlockEditValidation => ({
  _tag: 'Rejected',
  error: { _tag: 'ChunkWriteInvalidBatch', reason },
})

const isUnknownRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const isBlockPosition = (position: unknown): position is BlockPosition => {
  if (!isUnknownRecord(position)) {
    return false
  }

  return (
    typeof position['x'] === 'number' &&
    typeof position['y'] === 'number' &&
    typeof position['z'] === 'number' &&
    BlockAxis.is(position['x']) &&
    BlockAxis.is(position['y']) &&
    BlockAxis.is(position['z'])
  )
}

const validateEditValues = (edits: ReadonlyArray<unknown>): BlockEditValidation => {
  for (const value of edits) {
    if (!isUnknownRecord(value)) {
      return invalidBatch('invalid-edit')
    }

    if (!isBlockPosition(value['position'])) {
      return invalidBatch('invalid-position')
    }
    if (typeof value['block'] !== 'number' || !BlockId.is(value['block'])) {
      return invalidBatch('invalid-block-id')
    }
  }
  return { _tag: 'Valid' }
}

const validateUniqueBlockPositions = (edits: ReadonlyArray<ChunkBlockEdit>): BlockEditValidation => {
  const positions = new Set<string>()
  for (const edit of edits) {
    const key = blockPositionKey(edit.position)
    if (positions.has(key)) {
      return { _tag: 'Rejected', error: { _tag: 'ChunkWriteInvalidBatch', reason: 'duplicate-position' } }
    }
    positions.add(key)
  }
  return { _tag: 'Valid' }
}

const validateWorldHeight = (edits: ReadonlyArray<ChunkBlockEdit>): BlockEditValidation => {
  for (const edit of edits) {
    if (!isWorldY(edit.position.y)) {
      return { _tag: 'Rejected', error: { _tag: 'ChunkWriteInvalidBatch', reason: 'out-of-world' } }
    }
  }
  return { _tag: 'Valid' }
}

const validateUniquePositionsAndWorldHeight = (edits: ReadonlyArray<ChunkBlockEdit>): BlockEditValidation => {
  const uniquePositions = validateUniqueBlockPositions(edits)
  if (uniquePositions['_tag'] === 'Rejected') {
    return uniquePositions
  }
  return validateWorldHeight(edits)
}

const validateBlockEditBatch = (edits: ReadonlyArray<ChunkBlockEdit>): BlockEditValidation => {
  if (!Array.isArray(edits)) {
    return invalidBatch('not-array')
  }
  if (edits.length === NO_CHANGES) {
    return invalidBatch('empty')
  }
  const validEdits = validateEditValues(edits)
  if (validEdits['_tag'] === 'Rejected') {
    return validEdits
  }
  return validateUniquePositionsAndWorldHeight(edits)
}

type LoadedBlockEditValidation =
  | Readonly<{ readonly _tag: 'Resolved'; readonly edits: ReadonlyArray<ValidatedChunkBlockEdit> }>
  | Readonly<{ readonly _tag: 'Rejected'; readonly error: ChunkWritePrepareError }>

const resolveLoadedBlockEdits = (
  state: ChunkStoreState,
  edits: ReadonlyArray<ChunkBlockEdit>,
): LoadedBlockEditValidation => {
  const validated: ValidatedChunkBlockEdit[] = []
  for (const edit of edits) {
    const target = resolveLoadedChunk(state, edit.position)
    if (!target) {
      return {
        _tag: 'Rejected',
        error: { _tag: 'ChunkWriteChunkUnavailable', position: edit.position },
      }
    }
    validated.push({ edit, target })
  }
  return { _tag: 'Resolved', edits: validated }
}

export const prepareBlockWrites = (
  state: ChunkStoreState,
  edits: ReadonlyArray<ChunkBlockEdit>,
): ChunkWritePreparation => {
  const batchValidation = validateBlockEditBatch(edits)
  if (batchValidation['_tag'] === 'Rejected') {
    return batchValidation
  }
  const loadedValidation = resolveLoadedBlockEdits(state, edits)
  if (loadedValidation['_tag'] === 'Rejected') {
    return loadedValidation
  }
  return { _tag: 'Prepared', candidate: preparedCandidateFor(state, loadedValidation.edits) }
}

const blockWriteOutcome = (
  previous: BlockId,
  block: BlockId,
  coord: ChunkCoord,
): Extract<BlockWriteOutcome, { readonly _tag: 'Written' | 'Unchanged' }> => {
  if (previous === block) {
    return { _tag: 'Unchanged', previous }
  }
  return { _tag: 'Written', chunk: coord, previous }
}

export const prepareBlockWrite = (
  state: ChunkStoreState,
  position: BlockPosition,
  block: BlockId,
): SingleChunkWritePreparation => {
  if (!isWorldY(position.y)) {
    return { _tag: 'Rejected', outcome: WRITE_OUT_OF_WORLD }
  }

  const target = resolveLoadedChunk(state, position)
  if (!target) {
    return { _tag: 'Rejected', outcome: WRITE_CHUNK_NOT_LOADED }
  }

  const edit = { block, position }
  const previous = BlockId(getBlockAt(target.chunk, target.local.lx, target.local.ly, target.local.lz))
  const candidate = preparedCandidateFor(state, [{ edit, target }])
  const outcome: Extract<BlockWriteOutcome, { readonly _tag: 'Written' | 'Unchanged' }> =
    blockWriteOutcome(previous, block, target.coord)

  return { _tag: 'Prepared', candidate, outcome }
}

const changedLightsFor = (
  state: ChunkStoreState,
  loaded: ChunkStoreState['loaded'],
  changedBlocks: PreparedChunkWriteCandidate['changedBlocks'],
): ChunkStoreState['lights'] => {
  const { lights: initialLights } = state
  let lights = initialLights
  for (const changed of changedBlocks) {
    lights = relightAfterBlockChange({ ...state, lights, loaded }, changed.coord, changed.local)
  }
  return lights
}

const changedSubscribersFor = (
  state: ChunkStoreState,
  changedChunks: PreparedChunkWriteCandidate['changedChunks'],
): ChunkStoreState['subscribers'] => {
  const { subscribers: initialSubscribers } = state
  let subscribers = initialSubscribers
  for (const changed of changedChunks) {
    subscribers = noteChange(subscribers, changed.key, changed.coord, 'changed')
  }
  return subscribers
}

const publishChangedBlocks = (
  state: ChunkStoreState,
  candidate: PreparedChunkWriteCandidate,
): ChunkStoreState => {
  const { changedBlocks, changedChunks, chunks } = candidate
  const { loaded: currentLoaded } = state
  const loaded = new Map(currentLoaded)
  for (const [key, chunk] of chunks) {
    loaded.set(key, chunk)
  }
  const lights = changedLightsFor(state, loaded, changedBlocks)
  const subscribers = changedSubscribersFor(state, changedChunks)
  const revisions = incrementChunkRevisions(state, changedChunks.map(({ key }) => key))
  return {
    ...state,
    lights,
    loaded,
    ...revisions,
    subscribers,
  }
}

export const stalePreparedBlockWrite = (
  state: ChunkStoreState,
  candidate: PreparedChunkWriteCandidate,
): Option.Option<ChunkWriteStale> => {
  for (const { key } of candidate.changedChunks) {
    const expectedRevision = candidate.baseRevisions.get(key) ?? INITIAL_CHUNK_REVISION
    const actualRevision = Option.fromNullishOr(state.revisions.get(key))
    const revisionMatches = Option.match(actualRevision, {
      onNone: () => false,
      onSome: (revision) => revision === expectedRevision,
    })
    if (!revisionMatches) {
      const stale = Option.match(actualRevision, {
        onNone: () => ({ _tag: 'ChunkWriteStale' as const, expectedRevision, key }),
        onSome: (revision) => ({ _tag: 'ChunkWriteStale' as const, actualRevision: revision, expectedRevision, key }),
      })
      return Option.some(stale)
    }
  }
  return Option.none()
}

export const publishPreparedBlockWrite = (
  state: ChunkStoreState,
  candidate: PreparedChunkWriteCandidate,
): ChunkStoreState => {
  if (candidate.changedChunks.length === NO_CHANGES) {
    return state
  }
  return publishChangedBlocks(state, candidate)
}

const lightReadingForTarget = (
  state: ChunkStoreState,
  target: LoadedChunkTarget,
): readonly [LightReading, ChunkStoreState] => {
  const voxel = blockIndex(target.local.lx, target.local.ly, target.local.lz)
  const cached = state.lights.get(target.key)

  if (cached) {
    return [lightReading(getLightAt(cached.sky, voxel), getLightAt(cached.block, voxel)), state]
  }

  const lights = computeChunkLights(state.loaded)
  const computed = Option.getOrThrow(Option.fromNullishOr(lights.get(target.key)))

  return [
    lightReading(getLightAt(computed.sky, voxel), getLightAt(computed.block, voxel)),
    {
      lights,
      loaded: state.loaded,
      nextSubscriberId: state.nextSubscriberId,
      revisionClock: state.revisionClock,
      revisions: state.revisions,
      subscribers: state.subscribers,
    },
  ]
}

export const lightAt = (
  state: ChunkStoreState,
  position: BlockPosition,
): readonly [LightReading, ChunkStoreState] => {
  if (!isWorldY(position.y)) {
    return [LIGHT_OUT_OF_WORLD, state]
  }

  const target = resolveLoadedChunk(state, position)
  if (!target) {
    // NOT "dark". See `LightReading`: a caller that cannot tell an unlit cell
    // From an unloaded one spawns hostiles at the edge of the loaded area.
    return [LIGHT_CHUNK_NOT_LOADED, state]
  }

  return lightReadingForTarget(state, target)
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
/** The amount a fresh subscription advances `nextSubscriberId` by. */
const SUBSCRIBER_ID_STEP = 1

export const subscribed = (state: ChunkStoreState): readonly [SubscriberId, ChunkStoreState] => {
  const id: SubscriberId = state.nextSubscriberId
  const subscribers = new Map(state.subscribers)
  subscribers.set(id, EMPTY_SUBSCRIBER)

  return [
    id,
    {
      lights: state.lights,
      loaded: state.loaded,
      nextSubscriberId: state.nextSubscriberId + SUBSCRIBER_ID_STEP,
      revisionClock: state.revisionClock,
      revisions: state.revisions,
      subscribers,
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

  return {
    lights: state.lights,
    loaded: state.loaded,
    nextSubscriberId: state.nextSubscriberId,
    revisionClock: state.revisionClock,
    revisions: state.revisions,
    subscribers,
  }
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
/** A pending set with nothing in it. */
const EMPTY_SIZE = 0

export const drained = (
  state: ChunkStoreState,
  id: SubscriberId,
): readonly [ChunkDirtyBatch, ChunkStoreState] => {
  const pending = state.subscribers.get(id)

  if (!pending || (pending.changed.size === EMPTY_SIZE && pending.removed.size === EMPTY_SIZE)) {
    return [EMPTY_DIRTY_BATCH, state]
  }

  const batch: ChunkDirtyBatch = {
    changed: [...pending.changed.values()],
    removed: [...pending.removed.values()],
  }

  const subscribers = new Map(state.subscribers)
  subscribers.set(id, EMPTY_SUBSCRIBER)

  return [
    batch,
    {
      lights: state.lights,
      loaded: state.loaded,
      nextSubscriberId: state.nextSubscriberId,
      revisionClock: state.revisionClock,
      revisions: state.revisions,
      subscribers,
    },
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
  biomes: [...chunk.biomes],
  blocks: chunk.blocks.slice(),
  coord: chunk.coord,
})

/**
 * The four horizontal neighbours of a chunk, for boundary faces.
 *
 * Shaped to satisfy mc-meshing's `ChunkNeighbours` STRUCTURALLY (its
 * `domain/chunk-view.ts`: four optional `{ blocks }` values, `yPos`/`yNeg`
 * absent because chunks are full-height columns). mc-worldgen must not import
 * mc-meshing — that edge is intentionally absent from the dependency graph —
 * so the contract is structural rather than a nominal import, and
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

/** Adds one optional neighbour to an accumulator only when it is resident, never as an explicit `undefined`. */
const withDefinedNeighbour = (
  neighbours: ChunkNeighbours,
  key: keyof ChunkNeighbours,
  chunk: Chunk | undefined,
): ChunkNeighbours => {
  if (!chunk) {
    return neighbours
  }
  return { ...neighbours, [key]: chunk }
}

export const neighboursOf = (state: ChunkStoreState, coord: ChunkCoord): ChunkNeighbours => {
  const chunkAtOffset = (dcx: number, dcz: number): Chunk | undefined => {
    const adjacent = chunkCoordAtOffset(coord, dcx, dcz)
    if (!adjacent) {
      return
    }
    return residentChunk(state, adjacent)
  }
  const xPos = chunkAtOffset(NEIGHBOUR_OFFSET_STEP, NEIGHBOUR_OFFSET_NONE)
  const xNeg = chunkAtOffset(-NEIGHBOUR_OFFSET_STEP, NEIGHBOUR_OFFSET_NONE)
  const zPos = chunkAtOffset(NEIGHBOUR_OFFSET_NONE, NEIGHBOUR_OFFSET_STEP)
  const zNeg = chunkAtOffset(NEIGHBOUR_OFFSET_NONE, -NEIGHBOUR_OFFSET_STEP)

  const candidates: ReadonlyArray<readonly [keyof ChunkNeighbours, Chunk | undefined]> = [
    ['xPos', xPos],
    ['xNeg', xNeg],
    ['zPos', zPos],
    ['zNeg', zNeg],
  ]
  return candidates.reduce<ChunkNeighbours>((neighbours, [key, chunk]) => withDefinedNeighbour(neighbours, key, chunk), {})
}
