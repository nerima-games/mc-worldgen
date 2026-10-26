import { describe, expect, it } from '@effect/vitest'
import {
  makeInMemoryStorage,
  saveEnvelope,
  sealSaveEnvelope,
  StorageError,
  StoragePort,
  type StorageService,
} from '@nerima-games/mc-save'
import { Effect, Layer, Option, Result } from 'effect'
import { blockPosition } from '@nerima-games/mc-kernel'
import {
  makePersistentPortalRegistry,
  makePortalRegistry,
  PersistentPortalRegistryLayer,
  PortalRegistry,
  PortalRegistryLayer,
  portalRegistrySaveKey,
} from '../src/application/portal-registry'
import {
  emptyPortalRegistryState,
  portalsInDimension,
  registerPortal,
  unregisterPortal,
} from '../src/domain/portal-registry'
import { PORTAL_REGISTRY_FORMAT } from '../src/domain/portal-registry-format'
import { blockAxis } from './fixtures/validated-inputs'

const context = { worldId: 'world/one' }

const makePersistent = (storage: StorageService) =>
  makePersistentPortalRegistry(context).pipe(Effect.provideService(StoragePort, storage))

const makePersistentLayer = (storage: StorageService) =>
  PersistentPortalRegistryLayer(context).pipe(Layer.provide(Layer.succeed(StoragePort, storage)))

describe('portal registry domain', () => {
  it('keeps dimension-specific portals immutable and deduplicated', () => {
    const nether = blockPosition(blockAxis(8), blockAxis(64), blockAxis(8))
    const overworld = blockPosition(blockAxis(64), blockAxis(64), blockAxis(64))
    const end = blockPosition(blockAxis(0), blockAxis(64), blockAxis(0))

    const withNether = registerPortal(emptyPortalRegistryState, 'nether', nether)
    const withAll = registerPortal(registerPortal(withNether, 'overworld', overworld), 'end', end)

    expect(portalsInDimension(emptyPortalRegistryState, 'nether')).toStrictEqual([])
    expect(registerPortal(withNether, 'nether', nether)).toBe(withNether)
    expect(portalsInDimension(withAll, 'nether')).toStrictEqual([nether])
    expect(portalsInDimension(withAll, 'overworld')).toStrictEqual([overworld])
    expect(portalsInDimension(withAll, 'end')).toStrictEqual([end])

    expect(unregisterPortal(withAll, 'nether', overworld)).toBe(withAll)
    const withoutNether = unregisterPortal(withAll, 'nether', nether)
    expect(withoutNether).not.toBe(withAll)
    expect(portalsInDimension(withoutNether, 'nether')).toStrictEqual([])
    expect(portalsInDimension(withoutNether, 'overworld')).toStrictEqual([overworld])
  })

  it.effect('registers, resolves, unregisters, and resets portals in memory', () =>
    Effect.gen(function* () {
      const registry = yield* makePortalRegistry()
      const netherPortal = blockPosition(blockAxis(80), blockAxis(64), blockAxis(0))
      const overworldPortal = blockPosition(blockAxis(800), blockAxis(64), blockAxis(0))

      expect(yield* registry.register('nether', netherPortal)).toBe(true)
      expect(yield* registry.register('nether', netherPortal)).toBe(false)
      expect(yield* registry.portalsIn('nether')).toStrictEqual([netherPortal])

      const overworldTravel = yield* registry.resolveTravel('overworld', blockPosition(blockAxis(640), blockAxis(64), blockAxis(0)), 0)
      expect(overworldTravel.toDimension).toBe('nether')
      expect(overworldTravel.destination).toStrictEqual(netherPortal)
      expect(Option.isNone(overworldTravel.portalToCreate)).toBe(true)

      expect(yield* registry.register('overworld', overworldPortal)).toBe(true)
      const netherTravel = yield* registry.resolveTravel('nether', blockPosition(blockAxis(100), blockAxis(64), blockAxis(0)), 0)
      expect(netherTravel.toDimension).toBe('overworld')
      expect(netherTravel.destination).toStrictEqual(overworldPortal)
      expect(Option.isNone(netherTravel.portalToCreate)).toBe(true)

      const endTravel = yield* registry.resolveTravel('end', blockPosition(blockAxis(100), blockAxis(64), blockAxis(0)), 0)
      expect(endTravel.toDimension).toBe('overworld')
      expect(endTravel.destination).toStrictEqual(overworldPortal)
      expect(Option.isNone(endTravel.portalToCreate)).toBe(true)

      expect(yield* registry.unregister('nether', netherPortal)).toBe(true)
      expect(yield* registry.unregister('nether', netherPortal)).toBe(false)
      const newTravel = yield* registry.resolveTravel('overworld', blockPosition(blockAxis(640), blockAxis(64), blockAxis(0)), 0)
      expect(Option.isSome(newTravel.portalToCreate)).toBe(true)

      yield* registry.reset
      expect(yield* registry.portalsIn('nether')).toStrictEqual([])
      expect(yield* registry.portalsIn('overworld')).toStrictEqual([])
    }),
  )

  it.effect('persists portals and reloads the saved state', () =>
    Effect.gen(function* () {
      const storage = yield* makeInMemoryStorage
      const portal = blockPosition(blockAxis(12), blockAxis(70), blockAxis(-4))
      const key = portalRegistrySaveKey(context)
      const first = yield* makePersistent(storage)

      expect(yield* first.register('nether', portal)).toBe(true)
      expect(yield* storage.get(key)).toStrictEqual(expect.objectContaining({ _tag: 'Some' }))

      const second = yield* makePersistent(storage)
      expect(yield* second.portalsIn('nether')).toStrictEqual([portal])
      expect(yield* second.unregister('nether', portal)).toBe(true)

      const third = yield* makePersistent(storage)
      expect(yield* third.portalsIn('nether')).toStrictEqual([])
    }),
  )

  it.effect('does not publish a state transition when persistence fails', () =>
    Effect.gen(function* () {
      const backing = yield* makeInMemoryStorage
      const failing: StorageService = {
        ...backing,
        put: (key) => Effect.fail(new StorageError({ operation: 'test.put', key })),
      }
      const registry = yield* makePersistent(failing)
      const portal = blockPosition(blockAxis(1), blockAxis(64), blockAxis(1))

      const failure = yield* Effect.flip(registry.register('nether', portal))
      expect(failure._tag).toBe('StorageError')
      expect(yield* registry.portalsIn('nether')).toStrictEqual([])
      expect(yield* backing.get(portalRegistrySaveKey(context))).toStrictEqual(Option.none())
    }),
  )

  it.effect('rejects corrupt persisted portal state during construction', () =>
    Effect.gen(function* () {
      const storage = yield* makeInMemoryStorage
      yield* storage.put(
        portalRegistrySaveKey(context),
        Result.getOrThrow(sealSaveEnvelope(
          saveEnvelope(PORTAL_REGISTRY_FORMAT.name, PORTAL_REGISTRY_FORMAT.version, {
            end: [],
            nether: 'not-a-portal-list',
            overworld: [],
          }),
        )),
      )

      const failure = yield* Effect.flip(makePersistent(storage))
      expect(failure._tag).toBe('SaveDecodeError')
    }),
  )

  it.effect('provides in-memory and persistent registries through Effect layers', () =>
    Effect.gen(function* () {
      const inMemory = yield* Effect.provide(PortalRegistry, PortalRegistryLayer())
      expect(yield* inMemory.portalsIn('end')).toStrictEqual([])

      const storage = yield* makeInMemoryStorage
      const persistent = yield* Effect.provide(PortalRegistry, makePersistentLayer(storage))
      const portal = blockPosition(blockAxis(20), blockAxis(65), blockAxis(20))
      expect(yield* persistent.register('overworld', portal)).toBe(true)

      const reloaded = yield* Effect.provide(PortalRegistry, makePersistentLayer(storage))
      expect(yield* reloaded.portalsIn('overworld')).toStrictEqual([portal])
    }),
  )
})
