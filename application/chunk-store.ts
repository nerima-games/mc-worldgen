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
 * `Context.Tag` + an explicit `Layer`, not `Effect.Service`. A factory
 * (`makeChunkStore`) rather than a module-level singleton, so two playgrounds,
 * or a test and the game, can each hold their own — plan.md §3.8 records that
 * app-scope singletons were among the reference implementation's worst bug
 * sources, because a second world load inherited the first world's fibers and
 * refs and deadlocked. Every read-modify-write is one `Ref.modify`.
 */
import { Context, Effect, Layer, Ref } from 'effect'
import type { Chunk } from '../domain/chunk'
import * as Store from '../domain/chunk-store-state'
import type { BlockId, BlockPosition, ChunkCoord } from "@nerima-games/mc-kernel"
import { generateChunk, type GenerateOptions } from '../domain/terrain'

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
 * The lifecycle plan.md §3.7 eventually wants is cache → IndexedDB → generate.
 * This is the third arrow. The second belongs to mc-save and is not consumable
 * yet (plan.md §6 Step 3); when it is, it composes in front of this Port rather
 * than changing it.
 */
export type ChunkSource = (coord: ChunkCoord) => Effect.Effect<Chunk>

/** The default source: this repository's own pure, deterministic generator. */
export const generatedChunkSource =
  (seed: number, options: GenerateOptions = {}): ChunkSource =>
  (coord) =>
    Effect.sync(() => generateChunk(seed, coord, options))

/**
 * One reader's handle on the dirty channel.
 *
 * Held rather than registered-by-callback: a callback would mean mc-worldgen
 * holding a function supplied by mc-render, and the lifetime of that function
 * is mc-render's business. A handle that the holder drains is a lifetime the
 * holder already controls.
 */
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
  readonly load: (coord: ChunkCoord) => Effect.Effect<Chunk>
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
  readonly unload: (coord: ChunkCoord) => Effect.Effect<boolean>

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
   * This is the query `application/chunk-store.ts`'s own header (argument 2)
   * has assumed since it was written, and `docs/design-notes.md` DN-7 tracks the
   * two pieces still missing behind it: cross-chunk propagation and the
   * incremental two-queue engine.
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

/**
 * The scope type, aliased locally.
 *
 * `Effect.Scope` is re-exported by `effect`, but naming it here keeps the
 * signature above readable and keeps the import list to one line.
 */
type Scope = import('effect').Scope.Scope

export class ChunkStore extends Context.Tag('@nerima-games/mc-worldgen/ChunkStore')<
  ChunkStore,
  ChunkStoreApi
>() {}

export const makeChunkStore = (source: ChunkSource): Effect.Effect<ChunkStoreApi> =>
  Effect.map(Ref.make(Store.emptyChunkStoreState), (state) => {
    const drainFor = (id: Store.SubscriberId): Effect.Effect<Store.ChunkDirtyBatch> =>
      Ref.modify(state, (current) => Store.drained(current, id))

    const unsubscribeFor = (id: Store.SubscriberId): Effect.Effect<void> =>
      Ref.update(state, (current) => Store.unsubscribed(current, id))

    const subscribe: Effect.Effect<ChunkDirtySubscription> = Effect.map(
      Ref.modify(state, (current) => Store.subscribed(current)),
      (id) => ({ id, drain: drainFor(id), unsubscribe: unsubscribeFor(id) }),
    )

    return {
      load: (coord) =>
        Effect.gen(function* () {
          const resident = Store.residentChunk(yield* Ref.get(state), coord)
          if (resident !== undefined) {
            return resident
          }

          const generated = yield* source(coord)

          // Re-check inside the modify. Generation is an Effect and may suspend,
          // so another fiber can have loaded this coordinate meanwhile; the
          // first one to land wins and the loser's buffer is discarded. Handing
          // out two live views of one chunk would let two writers each see only
          // their own edits.
          return yield* Ref.modify(state, (current) => {
            const raced = Store.residentChunk(current, coord)
            return raced === undefined
              ? ([generated, Store.withChunk(current, generated)] as const)
              : ([raced, current] as const)
          })
        }),

      peek: (coord) => Effect.map(Ref.get(state), (current) => Store.residentChunk(current, coord)),

      snapshot: (coord) =>
        Effect.map(Ref.get(state), (current) => {
          const chunk = Store.residentChunk(current, coord)
          return chunk === undefined ? undefined : Store.chunkSnapshotOf(chunk)
        }),

      isLoaded: (coord) =>
        Effect.map(Ref.get(state), (current) => Store.residentChunk(current, coord) !== undefined),

      loadedCoords: Effect.map(Ref.get(state), Store.residentCoords),

      neighbours: (coord) => Effect.map(Ref.get(state), (current) => Store.neighboursOf(current, coord)),

      unload: (coord) => Ref.modify(state, (current) => Store.withoutChunk(current, coord)),

      getBlock: (position) => Effect.map(Ref.get(state), (current) => Store.blockAt(current, position)),

      setBlock: (position, block) =>
        Ref.modify(state, (current) => Store.withBlockAt(current, position, block)),

      // `Ref.modify` and not `Ref.get`, even though this reads. A cache miss
      // computes the chunk's grids and has to publish them, or the next reader
      // recomputes them; splitting that into a get and a set is the TOCTOU shape
      // this whole module avoids. `Store.lightAt` returns the state it was given
      // when the entry was already there, so the hot path writes back what it
      // read.
      getLight: (position) => Ref.modify(state, (current) => Store.lightAt(current, position)),

      subscribeDirty: subscribe,

      subscribeDirtyScoped: Effect.acquireRelease(subscribe, (subscription) => subscription.unsubscribe),

      reset: Ref.update(state, (current) =>
        Store.residentCoords(current).reduce<Store.ChunkStoreState>(
          (accumulated, coord) => Store.withoutChunk(accumulated, coord)[1],
          current,
        ),
      ),
    }
  })

/**
 * The in-memory implementation, as a `Layer`.
 *
 * "In-memory" is the whole of it today, and deliberately: persistence is
 * mc-save's toolkit applied to a format this repository defines (plan.md §3.7),
 * and mc-save is not consumable yet. When it is, the storage read composes in
 * front of `ChunkSource` and this Layer gains a parameter — no consumer of
 * `ChunkStoreApi` changes.
 */
export const ChunkStoreLayer = (source: ChunkSource): Layer.Layer<ChunkStore> =>
  Layer.effect(ChunkStore, makeChunkStore(source))

/** The common case: an in-memory store fed by this repository's generator. */
export const GeneratedChunkStoreLayer = (
  seed: number,
  options: GenerateOptions = {},
): Layer.Layer<ChunkStore> => ChunkStoreLayer(generatedChunkSource(seed, options))
