import { Context, Effect, Layer, Option, Ref } from 'effect'
import {
  type Dimension,
  PORTAL_SEARCH_RADIUS,
  type PortalTravelPlan,
  resolveNetherTravel,
} from '../domain/nether-travel.js'
import {
  type PortalRegistryState,
  emptyPortalRegistryState,
  portalsInDimension,
  registerPortal as registerPortalInState,
  unregisterPortal as unregisterPortalInState,
} from '../domain/portal-registry.js'
import {
  type SaveDecodeError,
  SaveKey,
  type StorageError,
  StoragePort,
  loadFrom,
  saveTo,
} from '@nerima-games/mc-save'
import { type BlockPosition } from '@nerima-games/mc-kernel'
import { PORTAL_REGISTRY_FORMAT } from '../domain/portal-registry-format.js'

// @nerima-games/mc-save 0.3.0 (Wave 0) dropped the standalone MigrationError
// Class from its public error surface; decode/migration failures are now
// Reported as SaveDecodeError. This union tracks mc-save's actual exports.
export type PortalRegistryPersistenceError = StorageError | SaveDecodeError

export type PortalRegistryPersistenceContext = {
  readonly worldId: string
}

export type PortalRegistryPersistence = {
  readonly load: Effect.Effect<Option.Option<PortalRegistryState>, PortalRegistryPersistenceError>
  readonly save: (state: PortalRegistryState) => Effect.Effect<void, PortalRegistryPersistenceError>
}

export const portalRegistrySaveKey = ({ worldId }: PortalRegistryPersistenceContext): SaveKey =>
  SaveKey(`portal-registry/${encodeURIComponent(worldId)}`)

export const makePortalRegistryPersistence = (
  context: PortalRegistryPersistenceContext,
): Effect.Effect<PortalRegistryPersistence, never, StoragePort> =>
  Effect.map(StoragePort, (storage) => ({
    load: loadFrom(PORTAL_REGISTRY_FORMAT, portalRegistrySaveKey(context)).pipe(
      Effect.provideService(StoragePort, storage),
    ),
    save: (state) =>
      saveTo(PORTAL_REGISTRY_FORMAT, portalRegistrySaveKey(context), state).pipe(
        Effect.provideService(StoragePort, storage),
      ),
  }))

export type PortalRegistryApi<ErrorType = PortalRegistryPersistenceError> = {
  readonly portalsIn: (
    dimension: Dimension,
  ) => Effect.Effect<ReadonlyArray<BlockPosition>, ErrorType>
  readonly register: (
    dimension: Dimension,
    position: BlockPosition,
  ) => Effect.Effect<boolean, ErrorType>
  readonly unregister: (
    dimension: Dimension,
    position: BlockPosition,
  ) => Effect.Effect<boolean, ErrorType>
  readonly resolveTravel: (
    from: Dimension,
    playerPosition: BlockPosition,
    searchRadius?: number,
  ) => Effect.Effect<PortalTravelPlan, ErrorType>
  readonly reset: Effect.Effect<void, ErrorType>
}

// The isolatedDeclarations flag forbids a call expression in an `extends`
// Clause (TS9021), so the Tag is built as a separately-typed constant first.
// The exported class then extends that plain identifier instead. Same shape
// As mc-kernel's ClockPort.
const PortalRegistryBase: Context.TagClass<
  PortalRegistry,
  '@nerima-games/mc-worldgen/PortalRegistry',
  PortalRegistryApi
> = Context.Tag('@nerima-games/mc-worldgen/PortalRegistry')<PortalRegistry, PortalRegistryApi>()

export class PortalRegistry extends PortalRegistryBase {}

type PortalRegistryWriter<ErrorType> = {
  readonly save: (state: PortalRegistryState) => Effect.Effect<void, ErrorType>
}

const cloneState = (state: PortalRegistryState): PortalRegistryState => ({
  end: [...state.end],
  nether: [...state.nether],
  overworld: [...state.overworld],
})

const REGISTRY_PERMITS = 1

const DESTINATION_DIMENSION: Readonly<Record<Dimension, Dimension>> = {
  end: 'overworld',
  nether: 'overworld',
  overworld: 'nether',
}

const makePortalRegistryInternal = <ErrorType>(
  initial: PortalRegistryState,
  persistence?: PortalRegistryWriter<ErrorType>,
): Effect.Effect<PortalRegistryApi<ErrorType>, ErrorType> =>
  Effect.gen(function* makePortalRegistryEffect() {
    const state = yield* Ref.make(cloneState(initial))
    const semaphore = yield* Effect.makeSemaphore(REGISTRY_PERMITS)
    const withPermit = <Result>(
      effect: Effect.Effect<Result, ErrorType>,
    ): Effect.Effect<Result, ErrorType> => semaphore.withPermits(REGISTRY_PERMITS)(effect)
    const commit = <Result>(
      transition: (current: PortalRegistryState) => readonly [Result, PortalRegistryState],
    ): Effect.Effect<Result, ErrorType> =>
      withPermit(
        Effect.gen(function* commitEffect() {
          const current = yield* Ref.get(state)
          const [result, next] = transition(current)
          if (next === current) {
            return result
          }
          if (persistence) {
            yield* persistence.save(next)
          }
          yield* Ref.set(state, next)
          return result
        }),
      )

    return {
      portalsIn: (dimension) =>
        withPermit(Effect.map(Ref.get(state), (current) => [...portalsInDimension(current, dimension)])),
      register: (dimension, position) =>
        commit((current) => {
          const next = registerPortalInState(current, dimension, position)
          return [next !== current, next]
        }),
      reset: Effect.asVoid(commit(() => [true, emptyPortalRegistryState])),
      resolveTravel: (from, playerPosition, searchRadius = PORTAL_SEARCH_RADIUS) =>
        withPermit(
          Effect.map(Ref.get(state), (current) =>
            resolveNetherTravel(
              from,
              playerPosition,
              portalsInDimension(current, DESTINATION_DIMENSION[from]),
              searchRadius,
            ),
          ),
        ),
      unregister: (dimension, position) =>
        commit((current) => {
          const next = unregisterPortalInState(current, dimension, position)
          return [next !== current, next]
        }),
    }
  })

export const makePortalRegistry = (
  initial: PortalRegistryState = emptyPortalRegistryState,
): Effect.Effect<PortalRegistryApi<never>> => makePortalRegistryInternal(initial)

export const makePersistentPortalRegistry = (
  context: PortalRegistryPersistenceContext,
): Effect.Effect<PortalRegistryApi, PortalRegistryPersistenceError, StoragePort> =>
  Effect.gen(function* makePersistentPortalRegistryEffect() {
    const persistence = yield* makePortalRegistryPersistence(context)
    const loaded = yield* persistence.load
    const initial = Option.match(loaded, {
      onNone: () => emptyPortalRegistryState,
      onSome: (state) => state,
    })
    return yield* makePortalRegistryInternal(initial, persistence)
  })

export const PortalRegistryLayer = (
  initial: PortalRegistryState = emptyPortalRegistryState,
): Layer.Layer<PortalRegistry> => Layer.effect(PortalRegistry, makePortalRegistry(initial))

export const PersistentPortalRegistryLayer = (
  context: PortalRegistryPersistenceContext,
): Layer.Layer<PortalRegistry, PortalRegistryPersistenceError, StoragePort> =>
  Layer.effect(PortalRegistry, makePersistentPortalRegistry(context))
