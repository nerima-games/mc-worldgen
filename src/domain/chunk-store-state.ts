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
 * The consequence is stated rather than hidden: **a `Chunk` handed out by this
 * store is a live view, not a snapshot.** `chunkSnapshotOf` exists for callers
 * that need a value that will not change under them. `test/chunk-store.test.ts`
 * pins both behaviours, so nobody has to discover the aliasing from a bug.
 *
 * What is NOT mutated in place is the bookkeeping: `loaded` and `subscribers`
 * are replaced wholesale on every transition, so the atomicity argument above
 * still holds for everything the `Ref` actually guards.
 */
import {
  BlockId,
  type BlockPosition,
  type ChunkCoord,
  type LocalBlockCoord,
  chunkCoord,
  chunkCoordOfBlock,
  localCoordOfBlock,
} from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, blockIndex } from './constants.js'
import { type Chunk, getBlockAt, setBlockAt } from './chunk.js'
import { type ChunkLight, computeChunkLights, getLightAt, updateChunkLights } from './light.js'

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

/** What an unparseable half of a `ChunkKey` falls back to; see `chunkCoordOfKey`. */
const FALLBACK_CHUNK_ORIGIN = 0

/**
 * Inverse of `chunkKeyOf`. Total: a key this module did not produce yields
 * `chunkCoord(0, 0)` rather than failing, because the only way to obtain a
 * `ChunkKey` is from `chunkKeyOf` and a caller therefore cannot reach the
 * fallback without a cast.
 */
export const chunkCoordOfKey = (key: ChunkKey): ChunkCoord => {
  const [cx, cz] = key.split(',')
  /**
   * PROVABLY DEAD (the `cx ?? FALLBACK_CHUNK_ORIGIN` fallback only):
   * `String.prototype.split` always returns a non-empty array — `''.split(',')`
   * is `['']`, not `[]` — so destructuring index 0 into `cx` can never be
   * `undefined`. Only `cz` (index 1) can be, when `key` has no comma at all;
   * that half is real and reachable — see `test/chunk-store.test.ts`'s "falls
   * back to the origin" case — which is why only `cx`'s half is ignored here
   * rather than the whole line.
   */
  return chunkCoord(
    /**
     * Esbuild drops a standalone inline "ignore next" comment during the TS
     * transform (verified empirically against esbuild.transform()). Vitest
     * 4's coverage-v8 provider reads that transformed code, so this
     * repository uses the start/stop hint pair instead: it is read from the
     * original source, which survives the transform.
     */
    // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
    /* v8 ignore start */
    Number(cx ?? FALLBACK_CHUNK_ORIGIN),
    // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
    /* v8 ignore stop */
    Number(cz ?? FALLBACK_CHUNK_ORIGIN),
  )
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
export const wasWritten = (outcome: BlockWriteOutcome): boolean => outcome['_tag'] === 'Written'

/** The lowest Y a chunk column represents. */
const WORLD_MIN_Y = 0

/** Is this Y inside the world column a chunk represents? */
export const isWorldY = (y: number): boolean => Number.isInteger(y) && y >= WORLD_MIN_Y && y < CHUNK_HEIGHT

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
  lights: new Map(),
  loaded: new Map(),
  nextSubscriberId: 0,
  subscribers: new Map(),
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
  kind: 'changed' | 'removed',
): DirtySubscriberState => {
  const changed = new Set(state.changed)
  const removed = new Set(state.removed)

  if (kind === 'changed') {
    // A chunk that comes back after being unloaded is a change, not a
    // Removal — and it must not be reported as both.
    removed.delete(key)
    changed.add(key)
  } else {
    changed.delete(key)
    removed.add(key)
  }

  return { changed, removed }
}

const noteChange = (
  subscribers: ReadonlyMap<SubscriberId, DirtySubscriberState>,
  key: ChunkKey,
  kind: 'changed' | 'removed',
): ReadonlyMap<SubscriberId, DirtySubscriberState> => {
  const next = new Map<SubscriberId, DirtySubscriberState>()

  for (const [id, state] of subscribers) {
    next.set(id, nextDirtySubscriberState(state, key, kind))
  }

  return next
}

/** The step of one chunk-grid cell; the value shared by every horizontal-neighbour offset below. */
const NEIGHBOUR_OFFSET_STEP = 1
/** No displacement along an axis, for the offset pairs below that only move on one axis. */
const NEIGHBOUR_OFFSET_NONE = 0

const HORIZONTAL_NEIGHBOUR_OFFSETS = [
  [NEIGHBOUR_OFFSET_STEP, NEIGHBOUR_OFFSET_NONE],
  [-NEIGHBOUR_OFFSET_STEP, NEIGHBOUR_OFFSET_NONE],
  [NEIGHBOUR_OFFSET_NONE, NEIGHBOUR_OFFSET_STEP],
  [NEIGHBOUR_OFFSET_NONE, -NEIGHBOUR_OFFSET_STEP],
] as const

const lightKeysAround = (coord: ChunkCoord): ReadonlyArray<ChunkKey> => [
  chunkKeyOf(coord),
  ...HORIZONTAL_NEIGHBOUR_OFFSETS.map(([dcx, dcz]) => chunkKeyOf(chunkCoord(coord.cx + dcx, coord.cz + dcz))),
]

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
  /**
   * PROVABLY DEAD (the `return false` below): `state.lights` is a subset of
   * `state.loaded`'s key set by construction throughout this module —
   * `withChunk` and `withoutChunk` only ever REMOVE keys from `lights` (via
   * `withoutLights`), never add one that is not already in `loaded`, and
   * `computeChunkLights`/`updateChunkLights` (in `light.ts`) only ever
   * populate entries for chunks already in the `loaded` map they are given.
   * A finite subset with the SAME cardinality as the set it is a subset of is
   * that set — so once the size check above has passed, every `loaded` key is
   * already known to be in `lights`, and this loop can only ever complete and
   * fall through to `return true`.
   */
  for (const key of state.loaded.keys()) {
    /** See `chunkCoordOfKey`'s ignore-hint comment for why this repository's ignore hints use the start/stop form. */
    // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
    /* v8 ignore start */
    if (!state.lights.has(key)) {return false}
    // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
    /* v8 ignore stop */
  }
  return true
}

/** Mark resident neighbours whose exposed boundary faces changed. */
const noteLoadedNeighbours = (
  subscribers: ReadonlyMap<SubscriberId, DirtySubscriberState>,
  loaded: ReadonlyMap<ChunkKey, Chunk>,
  coord: ChunkCoord,
): ReadonlyMap<SubscriberId, DirtySubscriberState> => {
  let next = subscribers

  for (const [dcx, dcz] of HORIZONTAL_NEIGHBOUR_OFFSETS) {
    const key = chunkKeyOf(chunkCoord(coord.cx + dcx, coord.cz + dcz))
    if (loaded.has(key)) {
      next = noteChange(next, key, 'changed')
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
    noteChange(state.subscribers, key, 'changed'),
    state.loaded,
    chunk.coord,
  )

  return {
    // A REPLACED chunk is a different world in the same place, so its cached
    // Light describes blocks that are gone. Dropping it here is what makes the
    // Reload path (storage, or a regenerated chunk) safe without the caller
    // Having to remember; leaving it would light a chunk from storage with the
    // Grid of whatever used to be resident at that coordinate.
    lights: withoutLights(state.lights, lightKeysAround(chunk.coord)),
    loaded,
    nextSubscriberId: state.nextSubscriberId,
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
    noteChange(state.subscribers, key, 'removed'),
    loaded,
    coord,
  )

  return [
    true,
    {
      // Not merely invalidated — the chunk is gone, so a grid kept here would be
      // A leak keyed by a coordinate nothing can reach.
      lights: withoutLights(state.lights, lightKeysAround(coord)),
      loaded,
      nextSubscriberId: state.nextSubscriberId,
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
  if (local.lx === CHUNK_LOCAL_MIN_XZ) {keys.push(chunkKeyOf(chunkCoord(coord.cx - NEIGHBOUR_OFFSET_STEP, coord.cz)))}
  if (local.lx === CHUNK_LOCAL_MAX_XZ) {keys.push(chunkKeyOf(chunkCoord(coord.cx + NEIGHBOUR_OFFSET_STEP, coord.cz)))}
  if (local.lz === CHUNK_LOCAL_MIN_XZ) {keys.push(chunkKeyOf(chunkCoord(coord.cx, coord.cz - NEIGHBOUR_OFFSET_STEP)))}
  if (local.lz === CHUNK_LOCAL_MAX_XZ) {keys.push(chunkKeyOf(chunkCoord(coord.cx, coord.cz + NEIGHBOUR_OFFSET_STEP)))}
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

  return [
    { _tag: 'Written', chunk: coord, previous },
    {
      lights: relightAfterBlockChange(state, coord, local),
      loaded: state.loaded,
      nextSubscriberId: state.nextSubscriberId,
      subscribers: noteChange(state.subscribers, key, 'changed'),
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
  const computed = lights.get(target.key)
  /**
   * PROVABLY DEAD (this guard and its body): `target` came from
   * `resolveLoadedChunk`, which only returns one after confirming
   * `state.loaded.get(target.key)` is a real `Chunk` — so `target.key` is
   * always a key of `state.loaded` here. `computeChunkLights` (`light.ts`)
   * builds its result via `indexChunks` + `collectLights`, which push into
   * `keys`/`chunks` together on every iteration of `for (const [key, chunk]
   * of loaded)` and then re-key the result from those same two index-aligned
   * arrays — so its returned map's key set is exactly `state.loaded`'s, never
   * a subset. `lights.get(target.key)` can therefore never miss.
   */
  // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
  /* v8 ignore start */
  if (!computed) {
    return [LIGHT_CHUNK_NOT_LOADED, state]
  }
  // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
  /* v8 ignore stop */

  return [
    lightReading(getLightAt(computed.sky, voxel), getLightAt(computed.block, voxel)),
    {
      lights,
      loaded: state.loaded,
      nextSubscriberId: state.nextSubscriberId,
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
  const id = state.nextSubscriberId as SubscriberId
  const subscribers = new Map(state.subscribers)
  subscribers.set(id, EMPTY_SUBSCRIBER)

  return [
    id,
    {
      lights: state.lights,
      loaded: state.loaded,
      nextSubscriberId: state.nextSubscriberId + SUBSCRIBER_ID_STEP,
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

  return { lights: state.lights, loaded: state.loaded, nextSubscriberId: state.nextSubscriberId, subscribers }
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
    changed: [...pending.changed].map(chunkCoordOfKey),
    removed: [...pending.removed].map(chunkCoordOfKey),
  }

  const subscribers = new Map(state.subscribers)
  subscribers.set(id, EMPTY_SUBSCRIBER)

  return [
    batch,
    { lights: state.lights, loaded: state.loaded, nextSubscriberId: state.nextSubscriberId, subscribers },
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
  const xPos = residentChunk(state, chunkCoord(coord.cx + NEIGHBOUR_OFFSET_STEP, coord.cz))
  const xNeg = residentChunk(state, chunkCoord(coord.cx - NEIGHBOUR_OFFSET_STEP, coord.cz))
  const zPos = residentChunk(state, chunkCoord(coord.cx, coord.cz + NEIGHBOUR_OFFSET_STEP))
  const zNeg = residentChunk(state, chunkCoord(coord.cx, coord.cz - NEIGHBOUR_OFFSET_STEP))

  const candidates: ReadonlyArray<readonly [keyof ChunkNeighbours, Chunk | undefined]> = [
    ['xPos', xPos],
    ['xNeg', xNeg],
    ['zPos', zPos],
    ['zNeg', zNeg],
  ]
  return candidates.reduce<ChunkNeighbours>((neighbours, [key, chunk]) => withDefinedNeighbour(neighbours, key, chunk), {})
}
