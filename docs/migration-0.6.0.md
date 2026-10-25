# Migrating to mc-worldgen 0.6

mc-worldgen 0.6 moves seed validation to the `NoiseSeed` brand, adds a required
capacity to chunk stores, and exposes the bounded store and renderer-facing
reads from the package root. Test helpers move to a dedicated package entry.

## Validate world seeds

Import `NoiseSeed` from the mc-worldgen package root and validate external
numbers before calling a generation API:

```ts
import { NoiseSeed } from '@nerima-games/mc-worldgen'
import { Result } from 'effect'

const seedResult = NoiseSeed.result(rawSeed)
if (Result.isFailure(seedResult)) {
  return seedResult
}

const chunk = generateChunk(seedResult.success, coord)
```

From 0.6 onward, non-integer seeds return a typed failure. `NaN`, infinities,
and integers outside JavaScript's safe-integer range also fail. The API does
not coerce an invalid value or replace it with a successful seed. Existing
integer seeds within the safe-integer range keep their generated chunk output.

## Provide a chunk-store capacity

Every chunk-store factory and layer now requires a `ChunkCapacity`. Construct
it at the configuration boundary and handle validation failure there:

```ts
import { ChunkCapacity, makeChunkStore } from '@nerima-games/mc-worldgen'
import { Result } from 'effect'

const capacityResult = ChunkCapacity.result(configuredCapacity)
if (Result.isFailure(capacityResult)) {
  return capacityResult
}

const store = yield* makeChunkStore(source, capacityResult.success)
```

The capacity must be a positive safe integer. There is no default. When a full
store needs room, it evicts the least recently used chunk. `load` and
`neighbours` update recency; `peek` and `snapshot` do not. A dirty chunk is
persisted before eviction. If persistence fails, the chunk stays resident and
`load` fails with a typed error.

## Select a store by dimension

Use `ChunkStoreRegistry` when a host needs independent stores for each
dimension:

```ts
const overworld = registry.forDimension('overworld')
const nether = registry.forDimension('nether')
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
Their planned move to mx-gameplay is scheduled for W4, after that repository
accepts the APIs.
