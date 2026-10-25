# Migrating to mc-worldgen 0.6

mc-worldgen 0.6 moves seed validation to the `NoiseSeed` brand, adds a required
capacity to chunk stores, and exposes the bounded store and renderer-facing
reads from the package root. Test helpers move to a dedicated package entry.

## Validate world seeds

Import `NoiseSeed` from the mc-worldgen package root and validate external
numbers before calling a generation API:

```ts
import { NoiseSeed, generateChunk } from '@nerima-games/mc-worldgen'
import { Result } from 'effect'
import type { ChunkCoord } from '@nerima-games/mc-kernel'

const generateFromRawSeed = (rawSeed: number, coord: ChunkCoord) => {
  const seed = NoiseSeed.result(rawSeed)
  if (Result.isFailure(seed)) return seed
  return generateChunk(seed.success, coord)
}
```

From 0.6 onward, non-integer seeds return a typed failure. `NaN`, infinities,
and integers outside JavaScript's safe-integer range also fail. The API does
not coerce an invalid value or replace it with a successful seed. Existing
integer seeds within the safe-integer range keep their generated chunk output.

## Provide a chunk-store capacity

Every chunk-store factory and layer now requires a `ChunkCapacity`. Validate
it at the configuration boundary and handle failure there. Pass the validated
value as the `capacity` argument to `makeChunkStore` or a store layer; the
`source` argument continues to provide chunks:

```ts
import { ChunkCapacity } from '@nerima-games/mc-worldgen'
import { Result } from 'effect'

const validateCapacity = (configuredCapacity: number) => {
  const result = ChunkCapacity.result(configuredCapacity)
  if (Result.isFailure(result)) return result
  return result.success
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
The persistent registry also receives the world ID and storage service.

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
Transfer to mx-gameplay is planned during its W4 migration. Until mx-gameplay
adopts these APIs, callers should continue importing them from mc-worldgen.
