/**
 * `ChunkStore` — the service that holds loaded chunks, accepts block writes,
 * and reports which chunks changed since you last looked.
 *
 * ---------------------------------------------------------------------------
 * Why this is in mc-worldgen and not in mc-sim
 * ---------------------------------------------------------------------------
 *
 * plan.md leaves the owner of the block WRITE path genuinely unassigned. §3.7
 * gives this repository `ChunkManager` — *ロード / アンロード / ダーティフラグ* —
 * while §3.8 gives mc-sim *ゲーム状態の中枢* and, in its public-API sentence,
 * *チャンクダーティ通知*. Both are foundation-tier, so plan.md §2.3-1's
 * noun/verb rule narrows the choice to these two and then stops.
 *
 * Four arguments settle it here, in decreasing order of force:
 *
 *  1. **The responsibility sentences.** §3.7's names チャンクのライフサイクル管理.
 *     §3.8's names EntityManager, PlayerService, InventoryService, health,
 *     hunger, XP, achievements, time, the game loop, settings and the camera
 *     pose — and does not name blocks or chunks at all. The one clause that
 *     does is in §3.8's *public API* list, not its responsibility list.
 *
 *  2. **One noun, one owner.** plan.md §3.7 also gives this repository the light
 *     grid (*チャンクデータの一部としてここが所有*) and the chunk save format. A
 *     block write invalidates light and dirties the saved chunk. Putting the
 *     buffer in mc-sim and the operations on that buffer here is two owners of
 *     one noun, which is the failure `mx-gameplay/stages/registration.ts`
 *     records in its own header: that repository held a second copy of the time
 *     of day until someone noticed only one of the two was being saved.
 *
 *  3. **Who decides versus who reads.** mc-sim's own decision procedure
 *     (`docs/responsibility.md` §3.2, question 3): *他のリポジトリが「読む」ため
 *     のものか、「決める」ためのものか → 決めるなら所有者側へ.* mc-worldgen
 *     decides what a chunk contains — it generates it, lights it and serialises
 *     it. mc-sim reads it to run physics. And plan.md §8 names mc-sim's API
 *     churn as the project's second risk: mc-sim has six consumers to
 *     mc-worldgen's five, so of two defensible homes this is the cheaper one to
 *     be wrong about.
 *
 *  4. **No new edge, in either direction.** Every repository that reads or
 *     writes blocks — mc-sim, mc-render, mc-playground-kit, mx-gameplay,
 *     mx-redstone — already depends on mc-worldgen in plan.md §2.1. Nothing
 *     here needs an edge that does not exist, and nothing needs one reversed.
 *
 * ---------------------------------------------------------------------------
 * What this contradicts, stated plainly
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.8 lists チャンクダーティ通知 among mc-sim's public API, and
 * mc-kernel's freeze checklist (question 6) repeats it. That clause is not
 * satisfiable alongside §3.7 without duplicating state: mc-worldgen cannot call
 * mc-sim (the edge is a cycle), so a notification published by mc-sim over
 * flags held here would have to be a per-frame poll of every loaded chunk —
 * which is the pull design mc-render's `docs/public-api.md` §3.3 rejects by
 * name, on the grounds that it is the same O(chunks × blocks) mistake plan.md
 * §3.11 records for falling blocks.
 *
 * So the channel lives with the flags, here, and mc-render subscribes to it
 * over the `render → worldgen` edge plan.md §2.1 already provides. mc-sim
 * relays nothing. If that reading of §3.8 is wrong, the alternative and its
 * consequences are written down in docs/public-api.md so the decision can be
 * reversed with evidence rather than re-litigated from memory.
 *
 * ---------------------------------------------------------------------------
 * House conventions this file is an instance of
 * ---------------------------------------------------------------------------
 *
 * `Context.Service` + an explicit `Layer`, not `Effect.Service`. A factory
 * (`makeChunkStore`) rather than a module-level singleton, so two playgrounds,
 * or a test and the game, can each hold their own — plan.md §3.8 records that
 * app-scope singletons were among the reference implementation's worst bug
 * sources, because a second world load inherited the first world's fibers and
 * refs and deadlocked. Every read-modify-write is one `Ref.modify`.
 */
import * as Store from '../domain/chunk-store-state.js'
import type { BlockId, BlockPosition, ChunkCoord, ChunkKey, Dimension } from '@nerima-games/mc-kernel'
import { Brand, Context, Data, Effect, Layer, Option, Ref, Semaphore } from 'effect'
import {
  type ChunkPersistence,
  type ChunkPersistenceContext,
  type ChunkPersistenceError,
  makeChunkPersistence,
} from './chunk-persistence.js'
import { type GenerateOptions, generateChunk } from '../domain/terrain.js'
import type { Chunk } from '../domain/chunk.js'
import type { StoragePort } from '@nerima-games/mc-save'
import { generateEndChunk } from '../domain/end-terrain.js'
import { generateNetherChunk } from '../domain/nether-terrain.js'
import { makeChunkStoreLru } from '../domain/chunk-store-lru.js'

const makeService = Context.Service
const taggedError = Data.TaggedError
const MIN_CHUNK_CAPACITY = 1
const CHUNK_STORE_PERMITS = 1

export type ChunkCapacity = number & Brand.Brand<'ChunkCapacity'>

/** A required positive safe-integer capacity for every resident-chunk cache. */
export const ChunkCapacity: Brand.Constructor<ChunkCapacity> = Brand.make<ChunkCapacity>(
  (value) => Number.isSafeInteger(value) && value >= MIN_CHUNK_CAPACITY || 'ChunkCapacity must be a positive safe integer',
)

/**
 * Where a chunk comes from when it is not resident.
 *
 * An `Effect` rather than a plain function, and that is the point: plan.md §3.7
 * requires a worker-pool Port *whose implementation the consumer injects*, and
 * the reference's port header is explicit that the application layer must not
 * know whether generation runs on a worker, on a pool, or synchronously. A
 * synchronous generator slots in with `Effect.sync`; mc-render's worker pool
 * slots in later without changing one line of `ChunkStoreApi`.
 *
 * The persistent layer implements plan.md §3.7's cache → storage → generate
 * lifecycle. This Port remains the final fallback, so worker-pool generation
 * stays independent from the mc-save storage implementation.
 */
export type ChunkSource = (coord: ChunkCoord) => Effect.Effect<Chunk>

/** The default source: this repository's own pure, deterministic generator. */
export const generatedChunkSource =
  (seed: NoiseSeed, options: GenerateOptions = {}): ChunkSource =>
  (coord) =>
    Effect.sync(() => generateChunk(seed, coord, options))

/** A deterministic source selected explicitly by dimension. */
export const generatedDimensionChunkSource = (
  seed: NoiseSeed,
  dimension: Dimension,
  options: GenerateOptions = {},
): ChunkSource => {
  if (dimension === 'overworld') {return generatedChunkSource(seed, options)}
  if (dimension === 'nether') {return (coord) => Effect.sync(() => generateNetherChunk(seed, coord))}
  return (coord) => Effect.sync(() => generateEndChunk(seed, coord))
}

/**
 * One reader's handle on the dirty channel.
 *
 * Held rather than registered-by-callback: a callback would mean mc-worldgen
 * holding a function supplied by mc-render, and the lifetime of that function
 * is mc-render's business. A handle that the holder drains is a lifetime the
 * holder already controls.
 */
import type { NoiseSeed } from '@nerima-games/mc-noise'
export type ChunkDirtySubscription = {
  readonly id: Store.SubscriberId
  /** Everything that changed since the previous drain. Clears the pending set. */
  readonly drain: Effect.Effect<Store.ChunkDirtyBatch>
  /** Detach. Idempotent. */
  readonly unsubscribe: Effect.Effect<void>
}

export type ChunkStoreApi = {
  /**
   * Make a chunk resident, generating it through `ChunkSource` if it is not.
   * Resolves to the LIVE chunk — see `domain/chunk-store-state.ts` on aliasing.
   */
  readonly load: (coord: ChunkCoord) => Effect.Effect<Chunk, ChunkStoreError>
  /** Look without loading. `undefined` if not resident. Live view. */
  readonly peek: (coord: ChunkCoord) => Effect.Effect<Chunk | undefined>
  /** A detached copy that will not change under the caller. */
  readonly snapshot: (coord: ChunkCoord) => Effect.Effect<Chunk | undefined>
  readonly isLoaded: (coord: ChunkCoord) => Effect.Effect<boolean>
  readonly loadedCoords: Effect.Effect<ReadonlyArray<ChunkCoord>>
  /**
   * The four horizontal neighbours, shaped to satisfy mc-meshing's
   * `ChunkNeighbours` structurally. Absent neighbours are absent, not
   * `undefined`.
   */
  readonly neighbours: (coord: ChunkCoord) => Effect.Effect<Store.ChunkNeighbours>
  /** Drop a chunk. Resolves to whether anything was resident. */
  readonly unload: (coord: ChunkCoord) => Effect.Effect<boolean, ChunkPersistenceError>

  /** Read one block. Total: distinguishes air from not-loaded from out-of-world. */
  readonly getBlock: (position: BlockPosition) => Effect.Effect<Store.BlockReading>
  /**
   * Write one block. Total — no error channel, because `StageRegistration.run`
   * has none either. Dirties the chunk only if the block actually changed, and
   * invalidates that chunk's light when it did.
   */
  readonly setBlock: (position: BlockPosition, block: BlockId) => Effect.Effect<Store.BlockWriteOutcome>

  /**
   * Read the sky and block light at one world position.
   *
   * TOTAL and three-valued, exactly as `getBlock` is, and for a sharper version
   * of the same reason: `ChunkNotLoaded` is not darkness. mx-gameplay's spawn
   * rule refuses a candidate whose light is unmeasurable precisely because
   * `NaN > 7` is `false`, so any collapsing of "I do not know" into a number
   * would spawn hostiles in a lit room at the edge of the loaded area.
   *
   * THE FIRST CALL AFTER A WRITE RELIGHTS THE CHUNK. Light is computed lazily
   * and cached, and a block write drops the cache entry — see
   * `domain/chunk-store-state.ts`, which states the cost and the measurement
   * that ruled out doing it eagerly. A caller on a per-frame path should know
   * that this read is occasionally O(chunk) rather than O(1); the only consumer
   * today runs on a spawn cadence, which is why that is acceptable.
   *
   * `computeChunkLights` solves all resident chunks together, including
   * horizontal seams. A complete cache takes the incremental fixed-point path
   * in `src/domain/light-update.ts`; a cold or partial cache uses the same resident-set
   * oracle lazily.
   */
  readonly getLight: (position: BlockPosition) => Effect.Effect<Store.LightReading>

  /** Register an independent reader of "which chunks changed since I last looked". */
  readonly subscribeDirty: Effect.Effect<ChunkDirtySubscription>
  /**
   * As `subscribeDirty`, but unsubscribes when the surrounding scope closes.
   * Prefer this: an un-detached subscriber accumulates chunk keys forever, and
   * plan.md §3.8's re-entrancy requirement is exactly about the leaks a second
   * world load inherits from the first.
   */
  readonly subscribeDirtyScoped: Effect.Effect<ChunkDirtySubscription, never, Scope>

  /**
   * Return to a fresh, empty world.
   *
   * Present from day one for the reason mc-sim's `InventoryService.reset` is:
   * this service is reused across world loads, and the reference's equivalent
   * omission (`game-state-service.ts:87-92`) made the second world inherit the
   * first world's state and fail session init.
   *
   * Existing subscriptions survive a reset and see the world drain — every
   * resident chunk is reported as removed. Silently emptying the world without
   * telling the renderer would leave it drawing geometry for chunks that no
   * longer exist.
   */
  readonly reset: Effect.Effect<void>
}

/** Errors that prevent a cache miss from making room for the requested chunk. */
type DirtyChunkEvictionFailure = {
  readonly _tag: 'DirtyChunkEvictionError'
  readonly coord: ChunkCoord
}

export type ChunkStoreError = ChunkPersistenceError | DirtyChunkEvictionFailure

class DirtyChunkEvictionError extends taggedError('DirtyChunkEvictionError')<{
  readonly coord: ChunkCoord
}> {}

/** The independent ChunkStore selected for one Minecraft dimension. */
export type ChunkStoreRegistry = {
  readonly forDimension: (dimension: Dimension) => ChunkStoreApi
}

/** Compatibility name retained for consumers that use the R2 API spelling. */
export type ChunkStoreRegistryApi = ChunkStoreRegistry

export const ChunkStoreRegistry: Context.Service<
  '@nerima-games/mc-worldgen/ChunkStoreRegistry',
  ChunkStoreRegistry
> = makeService<'@nerima-games/mc-worldgen/ChunkStoreRegistry', ChunkStoreRegistry>(
  '@nerima-games/mc-worldgen/ChunkStoreRegistry',
)

/**
 * The scope type, aliased locally.
 *
 * `Effect.Scope` is re-exported by `effect`, but naming it here keeps the
 * signature above readable and keeps the import list to one line.
 */
type Scope = import('effect').Scope.Scope

// The isolatedDeclarations flag forbids a call expression in an `extends`
// Clause (TS9021), so the Tag is built as a separately-typed constant first.
// The exported class then extends that plain identifier instead. Same shape
// As mc-kernel's ClockPort.
const ChunkStoreBase: Context.ServiceClass<
  ChunkStore,
  '@nerima-games/mc-worldgen/ChunkStore',
  ChunkStoreApi
> = makeService<ChunkStore, ChunkStoreApi>()('@nerima-games/mc-worldgen/ChunkStore')

export class ChunkStore extends ChunkStoreBase {}

/**
 * The chunk at `coord`: from storage if `persistence` has it, generated
 * through `source` otherwise. `persistence` itself is optional — the
 * in-memory-only store has none.
 */
const loadOrGenerate = (
  source: ChunkSource,
  persistence: ChunkPersistence | undefined,
  coord: ChunkCoord,
): Effect.Effect<Chunk, ChunkPersistenceError> =>
  Effect.gen(function* loadFromPersistenceOrSource() {
    if (!persistence) {
      return yield* source(coord)
    }

    const stored = yield* persistence.load(coord)
    if (Option.isSome(stored)) {
      return stored.value
    }

    return yield* source(coord)
  })

const chunksEqual = (left: Chunk, right: Chunk): boolean =>
  left.coord.cx === right.coord.cx &&
  left.coord.cz === right.coord.cz &&
  left.biomes.length === right.biomes.length &&
  left.biomes.every((biome, index) => biome === right.biomes[index]) &&
  left.blocks.length === right.blocks.length &&
  left.blocks.every((block, index) => block === right.blocks[index])

type ChunkStoreRuntimeState = {
  readonly chunks: Store.ChunkStoreState
  readonly dirty: ReadonlySet<ChunkKey>
}

type EvictionAction =
  | { readonly kind: 'evicted' }
  | { readonly kind: 'inconsistent' }
  | { readonly error: DirtyChunkEvictionError; readonly kind: 'fail' }
  | { readonly coord: ChunkCoord; readonly key: ChunkKey; readonly kind: 'persist'; readonly snapshot: Chunk }
  | { readonly kind: 'retry' }

type PersistEvictionAction = Extract<EvictionAction, { readonly kind: 'persist' }>
type EvictionPlan = (latest: ChunkStoreRuntimeState) => readonly [EvictionAction, ChunkStoreRuntimeState]
type ChunkStoreStateRef = Ref.Ref<ChunkStoreRuntimeState>
type ChunkStoreLru = ReturnType<typeof makeChunkStoreLru>

const makeEvictionPlanner = (
  lru: ChunkStoreLru,
  persistence?: ChunkPersistence,
): EvictionPlan => {
  const evictMissingChunk = (
    latest: ChunkStoreRuntimeState,
    key: ChunkKey,
  ): readonly [EvictionAction, ChunkStoreRuntimeState] => {
    lru.delete(key)
    const dirty = new Set(latest.dirty)
    dirty.delete(key)
    return [{ kind: 'retry' }, { ...latest, dirty }]
  }

  const evictDirtyChunk = (
    latest: ChunkStoreRuntimeState,
    key: ChunkKey,
    chunk: Chunk,
  ): readonly [EvictionAction, ChunkStoreRuntimeState] => {
    if (!persistence) {
      return [{ error: new DirtyChunkEvictionError({ coord: chunk.coord }), kind: 'fail' }, latest]
    }

    return [
      {
        coord: chunk.coord,
        key,
        kind: 'persist',
        snapshot: Store.chunkSnapshotOf(chunk),
      },
      latest,
    ]
  }

  const evictCleanChunk = (
    latest: ChunkStoreRuntimeState,
    key: ChunkKey,
    chunk: Chunk,
  ): readonly [EvictionAction, ChunkStoreRuntimeState] => {
    const [, chunks] = Store.withoutChunk(latest.chunks, chunk.coord)
    lru.delete(key)
    const dirty = new Set(latest.dirty)
    dirty.delete(key)
    return [{ kind: 'evicted' }, { chunks, dirty }]
  }

  return (latest) => {
    const key = lru.oldest()
    if (key === null) {
      return [{ kind: 'inconsistent' }, latest]
    }

    const chunk = latest.chunks.loaded.get(key)
    if (!chunk) {
      return evictMissingChunk(latest, key)
    }
    if (latest.dirty.has(key)) {
      return evictDirtyChunk(latest, key, chunk)
    }
    return evictCleanChunk(latest, key, chunk)
  }
}

const makeEvictionRuntime = (
  state: ChunkStoreStateRef,
  lru: ChunkStoreLru,
  capacity: ChunkCapacity,
  persistence?: ChunkPersistence,
): (() => Effect.Effect<void, ChunkStoreError>) => {
  const planEviction = makeEvictionPlanner(lru, persistence)

  const removeSavedChunk = (
    latest: ChunkStoreRuntimeState,
    action: PersistEvictionAction,
  ): readonly [boolean, ChunkStoreRuntimeState] => {
    const resident = Store.residentChunk(latest.chunks, action.coord)
    if (resident && !chunksEqual(resident, action.snapshot)) {
      return [false, latest]
    }

    lru.delete(action.key)
    const dirty = new Set(latest.dirty)
    dirty.delete(action.key)
    if (!resident) {
      return [true, { ...latest, dirty }]
    }

    const [, chunks] = Store.withoutChunk(latest.chunks, action.coord)
    return [true, { chunks, dirty }]
  }

  const persistEviction = (action: PersistEvictionAction): Effect.Effect<void, ChunkStoreError> =>
    Effect.gen(function* persist() {
      if (!persistence) {
        return yield* Effect.fail(new DirtyChunkEvictionError({ coord: action.coord }))
      }

      yield* persistence.save(action.snapshot)
      yield* Ref.modify(state, (latest) => removeSavedChunk(latest, action))
    })

  const processEvictionAction = (action: EvictionAction): Effect.Effect<void, ChunkStoreError> =>
    Effect.gen(function* processAction() {
      if (action.kind === 'inconsistent') {
        return yield* Effect.die('ChunkStore LRU does not contain every resident chunk')
      }
      if (action.kind === 'fail') {
        return yield* Effect.fail(action.error)
      }
      if (action.kind === 'persist') {
        yield* persistEviction(action)
      }
    })

  const evictOne = (): Effect.Effect<boolean, ChunkStoreError> =>
    Effect.gen(function* evictOnce() {
      const current = yield* Ref.get(state)
      if (current.chunks.loaded.size < capacity) {
        return true
      }

      const action = yield* Ref.modify(state, planEviction)
      yield* processEvictionAction(action)
      return false
    })

  const evictUntilRoom = (): Effect.Effect<void, ChunkStoreError> =>
    Effect.gen(function* evict() {
      while (true) {
        const hasRoom = yield* evictOne()
        if (hasRoom) {
          return
        }
      }
    })

  return evictUntilRoom
}

const makeChunkStoreInternal = (
  source: ChunkSource,
  capacity: ChunkCapacity,
  persistence?: ChunkPersistence,
): Effect.Effect<ChunkStoreApi> =>
  Effect.gen(function* makeStore() {
    const state = yield* Ref.make<ChunkStoreRuntimeState>({
      chunks: Store.emptyChunkStoreState,
      dirty: new Set<ChunkKey>(),
    })
    const lru = makeChunkStoreLru()
    const evictionLock = yield* Semaphore.make(CHUNK_STORE_PERMITS)
    const evictUntilRoom = makeEvictionRuntime(state, lru, capacity, persistence)

    const drainFor = (id: Store.SubscriberId): Effect.Effect<Store.ChunkDirtyBatch> =>
      Ref.modify(state, (current) => {
        const [batch, chunks] = Store.drained(current.chunks, id)
        return [batch, { ...current, chunks }]
      })

    const unsubscribeFor = (id: Store.SubscriberId): Effect.Effect<void> =>
      Ref.update(state, (current) => ({
        ...current,
        chunks: Store.unsubscribed(current.chunks, id),
      }))

    const subscribe: Effect.Effect<ChunkDirtySubscription> = Effect.map(
      Ref.modify(state, (current) => {
        const [id, chunks] = Store.subscribed(current.chunks)
        return [id, { ...current, chunks }]
      }),
      (id) => ({ drain: drainFor(id), id, unsubscribe: unsubscribeFor(id) }),
    )

    const loadOrTouch = (coord: ChunkCoord): Effect.Effect<Chunk | undefined> =>
      Ref.modify(state, (current) => {
        const chunk = Store.residentChunk(current.chunks, coord)
        if (chunk) {
          lru.touch(Store.chunkKeyOf(coord))
        }
        return [chunk, current]
      })

    const insertAfterEviction = (chunk: Chunk): Effect.Effect<Chunk, ChunkStoreError> =>
      evictionLock.withPermit(
        Effect.gen(function* insert() {
          const raced = yield* loadOrTouch(chunk.coord)
          if (raced) {
            return raced
          }

          yield* evictUntilRoom()

          return yield* Ref.modify(state, (current) => {
            const existing = Store.residentChunk(current.chunks, chunk.coord)
            if (existing) {
              lru.touch(Store.chunkKeyOf(chunk.coord))
              return [existing, current]
            }

            const key = Store.chunkKeyOf(chunk.coord)
            lru.add(key)
            return [chunk, { ...current, chunks: Store.withChunk(current.chunks, chunk) }]
          })
        }),
      )

    return {
      getBlock: (position) => Effect.map(Ref.get(state), (current) => Store.blockAt(current.chunks, position)),

      // `Ref.modify` and not `Ref.get`, even though this reads. A cache miss
      // Computes the chunk's grids and has to publish them, or the next reader
      // Recomputes them; splitting that into a get and a set is the TOCTOU shape
      // This whole module avoids. `Store.lightAt` returns the state it was given
      // When the entry was already there, so the hot path writes back what it
      // Read.
      getLight: (position) =>
        Ref.modify(state, (current) => {
          const [reading, chunks] = Store.lightAt(current.chunks, position)
          return [reading, { ...current, chunks }]
        }),

      isLoaded: (coord) => Effect.map(Ref.get(state), (current) => Boolean(Store.residentChunk(current.chunks, coord))),

      load: (coord) =>
        Effect.gen(function* load() {
          const resident = yield* loadOrTouch(coord)
          if (resident) {
            return resident
          }

          const generated = yield* loadOrGenerate(source, persistence, coord)
          return yield* insertAfterEviction(generated)
        }),

      loadedCoords: Effect.map(Ref.get(state), (current) => Store.residentCoords(current.chunks)),

      neighbours: (coord) =>
        Ref.modify(state, (current) => {
          const neighbours = Store.neighboursOf(current.chunks, coord)
          for (const chunk of [neighbours.xPos, neighbours.xNeg, neighbours.zPos, neighbours.zNeg]) {
            if (chunk) {
              lru.touch(Store.chunkKeyOf(chunk.coord))
            }
          }
          return [neighbours, current]
        }),

      peek: (coord) => Effect.map(Ref.get(state), (current) => Store.residentChunk(current.chunks, coord)),

      reset: Ref.update(state, (current) =>
        {
          lru.clear()
          return {
            chunks: Store.residentCoords(current.chunks).reduce<Store.ChunkStoreState>((accumulated, coord) => {
              const [, nextState] = Store.withoutChunk(accumulated, coord)
              return nextState
            }, current.chunks),
            dirty: new Set<ChunkKey>(),
          }
        },
      ),

      setBlock: (position, block) =>
        Ref.modify(state, (current): readonly [Store.BlockWriteOutcome, ChunkStoreRuntimeState] => {
          const [outcome, chunks] = Store.withBlockAt(current.chunks, position, block)
          if (!('chunk' in outcome)) {
            return [outcome, current]
          }

          const dirty = new Set(current.dirty)
          dirty.add(Store.chunkKeyOf(outcome.chunk))
          return [outcome, { chunks, dirty }]
        }),

      snapshot: (coord) =>
        Effect.map(Ref.get(state), (current) => {
          const chunk = Store.residentChunk(current.chunks, coord)
          if (chunk) {
            return Store.chunkSnapshotOf(chunk)
          }
          return
        }),

      subscribeDirty: subscribe,

      subscribeDirtyScoped: Effect.acquireRelease(subscribe, (subscription) => subscription.unsubscribe),

      unload: (coord) => {
        if (!persistence) {
          return Ref.modify(state, (current) => {
            const [removed, chunks] = Store.withoutChunk(current.chunks, coord)
            if (!removed) {
              return [false, current]
            }

            const dirty = new Set(current.dirty)
            dirty.delete(Store.chunkKeyOf(coord))
            lru.delete(Store.chunkKeyOf(coord))
            return [true, { chunks, dirty }]
          })
        }

        const saveUntilCurrent = (): Effect.Effect<boolean, ChunkPersistenceError> =>
          Effect.gen(function* attemptSave() {
            const resident = Store.residentChunk((yield* Ref.get(state)).chunks, coord)
            if (!resident) {
              return false
            }

            const snapshot = Store.chunkSnapshotOf(resident)
            yield* persistence.save(snapshot)

            const removed = yield* Ref.modify(state, (current) => {
              const latest = Store.residentChunk(current.chunks, coord)
              if (latest && chunksEqual(latest, snapshot)) {
                const [, chunks] = Store.withoutChunk(current.chunks, coord)
                const dirty = new Set(current.dirty)
                dirty.delete(Store.chunkKeyOf(coord))
                lru.delete(Store.chunkKeyOf(coord))
                return [true, { chunks, dirty }]
              }
              return [false, current] as const
            })

            if (removed) {
              return true
            }
            return yield* saveUntilCurrent()
          })

        return saveUntilCurrent()
      },
    }
  })

export const makeChunkStore = (source: ChunkSource, capacity: ChunkCapacity): Effect.Effect<ChunkStoreApi> =>
  makeChunkStoreInternal(source, capacity)

export const makePersistentChunkStore = (
  source: ChunkSource,
  context: ChunkPersistenceContext,
  capacity: ChunkCapacity,
): Effect.Effect<ChunkStoreApi, never, StoragePort> =>
  Effect.flatMap(makeChunkPersistence(context), (persistence) =>
    makeChunkStoreInternal(source, capacity, persistence),
  )

/**
 * The in-memory implementation, as a `Layer`. Use
 * `PersistentChunkStoreLayer` when unloads must be written through mc-save.
 */
export const ChunkStoreLayer = (source: ChunkSource, capacity: ChunkCapacity): Layer.Layer<ChunkStore> =>
  Layer.effect(ChunkStore, makeChunkStore(source, capacity))

/** The common case: an in-memory store fed by this repository's generator. */
export const GeneratedChunkStoreLayer = (
  seed: NoiseSeed,
  capacity: ChunkCapacity,
  options: GenerateOptions = {},
): Layer.Layer<ChunkStore> => ChunkStoreLayer(generatedChunkSource(seed, options), capacity)

export const GeneratedDimensionChunkStoreLayer = (
  seed: NoiseSeed,
  dimension: Dimension,
  capacity: ChunkCapacity,
  options: GenerateOptions = {},
): Layer.Layer<ChunkStore> => ChunkStoreLayer(generatedDimensionChunkSource(seed, dimension, options), capacity)

export const PersistentChunkStoreLayer = (
  source: ChunkSource,
  context: ChunkPersistenceContext,
  capacity: ChunkCapacity,
): Layer.Layer<ChunkStore, never, StoragePort> =>
  Layer.effect(ChunkStore, makePersistentChunkStore(source, context, capacity))

export const PersistentGeneratedChunkStoreLayer = (
  seed: NoiseSeed,
  context: ChunkPersistenceContext,
  capacity: ChunkCapacity,
  options: GenerateOptions = {},
): Layer.Layer<ChunkStore, never, StoragePort> =>
  PersistentChunkStoreLayer(generatedChunkSource(seed, options), context, capacity)

export const PersistentGeneratedDimensionChunkStoreLayer = (
  seed: NoiseSeed,
  dimension: Dimension,
  context: ChunkPersistenceContext,
  capacity: ChunkCapacity,
  options: GenerateOptions = {},
): Layer.Layer<ChunkStore, never, StoragePort> => {
  if (dimension !== context.dimension) {
    throw new RangeError(
      `Generated dimension "${dimension}" does not match persistence dimension "${context.dimension}"`,
    )
  }
  return PersistentChunkStoreLayer(generatedDimensionChunkSource(seed, dimension, options), context, capacity)
}

/** Create one independent bounded store per dimension from its chunk source. */
export const ChunkStoreRegistryLayer = (
  sourceForDimension: (dimension: Dimension) => ChunkSource,
  capacity: ChunkCapacity,
): Layer.Layer<'@nerima-games/mc-worldgen/ChunkStoreRegistry'> =>
  Layer.effect(
    ChunkStoreRegistry,
    Effect.gen(function* makeRegistry() {
      const overworld = yield* makeChunkStoreInternal(sourceForDimension('overworld'), capacity)
      const nether = yield* makeChunkStoreInternal(sourceForDimension('nether'), capacity)
      const end = yield* makeChunkStoreInternal(sourceForDimension('end'), capacity)
      const stores = Object.setPrototypeOf({ end, nether, overworld }, null)
      return { forDimension: (dimension) => stores[dimension] }
    }),
  )

/** Persistent counterpart to `ChunkStoreRegistryLayer`, with a separate namespace per dimension. */
export const PersistentChunkStoreRegistryLayer = (
  sourceForDimension: (dimension: Dimension) => ChunkSource,
  worldId: string,
  capacity: ChunkCapacity,
): Layer.Layer<'@nerima-games/mc-worldgen/ChunkStoreRegistry', never, StoragePort> =>
  Layer.effect(
    ChunkStoreRegistry,
    Effect.gen(function* makePersistentRegistry() {
      const overworld = yield* makePersistentChunkStore(
        sourceForDimension('overworld'),
        { dimension: 'overworld', worldId },
        capacity,
      )
      const nether = yield* makePersistentChunkStore(
        sourceForDimension('nether'),
        { dimension: 'nether', worldId },
        capacity,
      )
      const end = yield* makePersistentChunkStore(
        sourceForDimension('end'),
        { dimension: 'end', worldId },
        capacity,
      )
      const stores = Object.setPrototypeOf({ end, nether, overworld }, null)
      return { forDimension: (dimension) => stores[dimension] }
    }),
  )
