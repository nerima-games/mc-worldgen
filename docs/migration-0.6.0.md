# Migrating to mc-worldgen 0.6

mc-worldgen 0.6 moves seed validation to the `NoiseSeed` brand, adopts
mc-kernel's branded coordinate types, adds a required capacity to chunk stores,
and exposes the bounded store and renderer-facing reads from the package root.
Test helpers move to a dedicated package entry.

## Validate world seeds

Import `NoiseSeed` from the mc-worldgen package root and validate external
numbers before calling a generation API:

```ts
import { NoiseSeed, generateChunk } from '@nerima-games/mc-worldgen'
import { Result } from 'effect'
import type { ChunkCoord } from '@nerima-games/mc-kernel'

const generateFromRawSeed = (rawSeed: number, coord: ChunkCoord) => {
  const seed = NoiseSeed.result(rawSeed)
  if (Result.isFailure(seed)) {
    return { _tag: 'InvalidSeed', cause: seed.failure } as const
  }

  const generated = generateChunk(seed.success, coord)
  if (Result.isFailure(generated)) {
    return { _tag: 'InvalidNaturalStructureCoordinate', cause: generated.failure } as const
  }
  return { _tag: 'Generated', chunk: generated.success } as const
}
```

From 0.6 onward, non-integer seeds return a typed failure. `NaN`, infinities,
and integers outside JavaScript's safe-integer range also fail. The API does
not coerce an invalid value or replace it with a successful seed. Existing
integer seeds within the safe-integer range keep their generated chunk output.
Structure-generating functions also return a synchronous `Result`; handle its
`InvalidNaturalStructureCoordinate` failure when a region or derived structure
footprint cannot be represented by safe block coordinates.

## Validate coordinates at raw input boundaries

mc-kernel 0.9 brands safe-integer block coordinates as `BlockAxis`, chunk
coordinates as `ChunkAxis`, and chunk-local X/Z offsets as `LocalAxis`.
`ChunkCoord` stores `cx` and `cz` as `ChunkAxis`; it no longer accepts plain
numbers. Import the constructors from the mc-kernel package root. Use `.result`
when the caller needs a typed validation failure, and `.option` when an invalid
coordinate means the operation has no value.

Validate raw chunk coordinates before calling `generateChunkAt`:

```ts
import { ChunkAxis } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import { generateChunkAt, type NoiseSeed } from '@nerima-games/mc-worldgen'

const generateFromRawChunkCoords = (
  seed: NoiseSeed,
  rawCx: number,
  rawCz: number,
) => {
  const cx = ChunkAxis.result(rawCx)
  if (Result.isFailure(cx)) {
    return { _tag: 'InvalidCoordinate', axis: 'cx', cause: cx.failure } as const
  }

  const cz = ChunkAxis.result(rawCz)
  if (Result.isFailure(cz)) {
    return { _tag: 'InvalidCoordinate', axis: 'cz', cause: cz.failure } as const
  }

  const generated = generateChunkAt(seed, cx.success, cz.success)
  if (Result.isFailure(generated)) {
    return { _tag: 'InvalidNaturalStructureCoordinate', cause: generated.failure } as const
  }
  return { _tag: 'Generated', chunk: generated.success } as const
}

const consumeRawChunkCoords = (seed: NoiseSeed, rawCx: number, rawCz: number) => {
  const result = generateFromRawChunkCoords(seed, rawCx, rawCz)
  if (result._tag !== 'Generated') return result // report or propagate the invalid input
  return result.chunk
}
```

`BlockAxis.result` validates world-space X/Y/Z coordinates. `LocalAxis.option`
validates chunk-local X/Z offsets, which must be integers from 0 through 15.
For example, `getBlockAt` expects local X/Z and a world-space Y:

```ts
import { BlockAxis, LocalAxis } from '@nerima-games/mc-kernel'
import { Option, Result } from 'effect'
import { getBlockAt, type Chunk } from '@nerima-games/mc-worldgen'

const readAtRawLocalCoords = (
  chunk: Chunk,
  rawLx: number,
  rawY: number,
  rawLz: number,
) => {
  const y = BlockAxis.result(rawY)
  if (Result.isFailure(y)) {
    return { _tag: 'InvalidCoordinate', axis: 'y', cause: y.failure } as const
  }

  const lx = LocalAxis.option(rawLx)
  const lz = LocalAxis.option(rawLz)
  if (Option.isNone(lx) || Option.isNone(lz)) {
    return { _tag: 'InvalidCoordinate' } as const
  }

  return { _tag: 'Read', block: getBlockAt(chunk, lx.value, y.success, lz.value) } as const
}
```

Handle invalid `BlockAxis.result` values through its `Failure` branch. Handle
`LocalAxis.option` returning `None` as an invalid local offset; do not read the
array with that coordinate. The `Read` result from `getBlockAt` is distinct from
the invalid-coordinate result.

Region planners and the `villageSiteForRegion` / `strongholdSiteForRegion`
selectors take numeric region indices, not `ChunkAxis` values. Planners return
`Result.Result<Option.Option<NaturalStructurePlan>, InvalidNaturalStructureCoordinate>`;
the site selectors return the same shape with their site type. Propagate or
report a `Failure` for an invalid coordinate, and treat `Success(None)` as a
valid region with no structure candidate. The
`InvalidNaturalStructureCoordinate` error class is exported from the
mc-worldgen package root; its `axis`, `kind`, `region`, and `value` fields
identify the invalid region or derived footprint coordinate.
`naturalStructurePlansForChunk` returns the same failure alongside its plan
array. `generateChunk`, `generateNetherChunk`, `generateEndChunk`, and their
`*At` variants return it alongside the generated chunk; generated `ChunkSource`
values propagate it through the `Effect` error channel.

The chunk queries return these results:

- `villageSitesNearChunk`: `Result.Result<ReadonlyArray<VillageSite>, InvalidNaturalStructureCoordinate>`.
- `strongholdSitesNearChunk`: `Result.Result<ReadonlyArray<StrongholdSite>, InvalidNaturalStructureCoordinate>`.
- `villageVillagerSpawnsForChunk`: `Result.Result<ReadonlyArray<VillageVillagerSpawn>, InvalidNaturalStructureCoordinate>`.

`strongholdSitesNearChunk` requires `halfExtent` to be a nonnegative safe integer. An invalid value returns `Failure(InvalidNaturalStructureCoordinate)`.

Handle `Failure(InvalidNaturalStructureCoordinate)` for an invalid chunk
coordinate or an unrepresentable derived coordinate. `Success([])` means the
valid query found no sites or spawns.

```ts
import { Option, Result } from 'effect'
import {
  planStrongholdForRegion,
  type NaturalStructurePlanResult,
} from '@nerima-games/mc-worldgen'
import type { NoiseSeed } from '@nerima-games/mc-noise'

const planStronghold = (seed: NoiseSeed, regionX: number, regionZ: number) => {
  const result: NaturalStructurePlanResult = planStrongholdForRegion(seed, regionX, regionZ)
  if (Result.isFailure(result)) {
    return {
      _tag: 'InvalidCoordinate',
      axis: result.failure.axis,
      region: result.failure.region,
      value: result.failure.value,
    } as const
  }
  if (Option.isNone(result.success)) return { _tag: 'NoPlan' } as const
  return { _tag: 'Planned', plan: result.success.value } as const
}
```

## Provide a chunk-store capacity

Every chunk-store factory and layer now requires a `ChunkCapacity`. Validate
it at the configuration boundary and handle failure there. Pass the validated
value as the `capacity` argument to `makeChunkStore` or a store layer. This
example validates configuration and creates an in-memory store backed by the
dimension generator:

```ts
import { ChunkCapacity, generatedChunkSource, makeChunkStore, type NoiseSeed } from '@nerima-games/mc-worldgen'
import { Result } from 'effect'

const makeGeneratedStore = (seed: NoiseSeed, configuredCapacity: number) => {
  const capacity = ChunkCapacity.result(configuredCapacity)
  if (Result.isFailure(capacity)) {
    return { _tag: 'InvalidCapacity', cause: capacity.failure } as const
  }
  return {
    _tag: 'Store',
    store: makeChunkStore(generatedChunkSource(seed), capacity.success),
  } as const
}
```

The capacity must be a positive safe integer. There is no default. When a full
store needs room, it evicts the least recently used chunk. `load` and
`neighbours` update recency; `peek` and `snapshot` do not. A dirty chunk is
persisted before eviction. If persistence fails, the chunk stays resident and
`load` fails with a typed error.

## Select a store by dimension

Use `ChunkStoreRegistryLayer` to provide the registry service, then obtain
it inside an Effect program with `ChunkStoreRegistry`:

```ts
import {
  ChunkCapacity,
  ChunkStoreRegistry,
  ChunkStoreRegistryLayer,
} from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'

const getOverworldStore = (
  sourceForDimension: Parameters<typeof ChunkStoreRegistryLayer>[0],
  capacity: ChunkCapacity,
) =>
  Effect.provide(
    Effect.gen(function* () {
      const registry = yield* ChunkStoreRegistry
      return registry.forDimension('overworld')
    }),
    ChunkStoreRegistryLayer(sourceForDimension, capacity),
  )
```

The registry layer requires the same `ChunkCapacity` as an individual store.
For persistent stores, `PersistentChunkStoreRegistryLayer(sourceForDimension,
worldId, capacity)` takes the world ID as a function argument and requires
`StoragePort` from `@nerima-games/mc-save` in its Effect layer environment.
Provide that service at the application boundary; it is not a layer function
argument.

## Use the package root and testing entry

The package root exports `Chunk`, `ChunkNeighbours`, `LightReading`,
`CHUNK_HEIGHT`, `ChunkStoreRegistry`, `ChunkCapacity`, and the renderer-facing
`ChunkStoreApi` reads: `peek`, `neighbours`, `subscribeDirty`, and `getLight`.
`chunkKeyOf` is the kernel function and returns kernel's branded `ChunkKey`.
Import the `ChunkKey` type itself from `@nerima-games/mc-kernel`.

The test-only helpers `emptyBlocks`, `setBlockAt`, and type `SubscriberId` are
available from `@nerima-games/mc-worldgen/testing`. They are no longer exported
from the production package root.

## Resolver ownership

`resolveNetherTravel` and `resolveEndGatewayExit` remain available in 0.6.
Transfer to mx-gameplay is planned. Until that package exports these APIs,
callers should continue importing them from mc-worldgen.
