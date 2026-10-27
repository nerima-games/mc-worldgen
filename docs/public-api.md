# Public API

## mc-worldgen public surface

Import production mc-worldgen APIs from the package root. Testing utilities are at `@nerima-games/mc-worldgen/testing`. For seed and coordinate constructors and validation, see [validate world seeds](./migration-0.6.0.md#validate-world-seeds) and [validate raw coordinates](./migration-0.6.0.md#validate-coordinates-at-raw-input-boundaries).

`Result.Result<A, E>` is an `effect` result with `Success(A)` or `Failure(E)`; `Option.Option<A>` is `Some(A)` or `None`. A typed error in an `Effect.Effect<A, E, R>` is reported through the Effect error channel.

- Generation APIs accept mc-noise's `NoiseSeed`. The package root re-exports it. Validate external numbers with `NoiseSeed.result`; fractional values, `NaN`, infinities, and integers outside the safe-integer range fail. Valid integer seeds retain their generated output.
- Coordinates use mc-kernel 0.9 brands. `ChunkCoord` contains `ChunkAxis` values, block positions use `BlockAxis`, and chunk-local horizontal positions use `LocalAxis`.
- Every chunk-store factory and layer requires a positive safe-integer `ChunkCapacity`. A full store evicts its least recently used clean chunk. Dirty chunks are persisted before eviction; a failed save leaves the chunk resident and returns a typed error.
- `ChunkStoreRegistry` provides an independent bounded `ChunkStoreApi` for each dimension. Its renderer-facing reads are `peek`, `neighbours`, `subscribeDirty`, and `getLight`.
- The package root exports `Chunk`, `ReadonlyChunk`, `ReadonlyUint16Array`, `ChunkNeighbours`, `LightReading`, `CHUNK_HEIGHT`, and `chunkKeyOf`. The latter is re-exported from mc-kernel and returns its branded `ChunkKey`; import the `ChunkKey` type from mc-kernel.
- The package root exports `detectNetherPortal` and `generatePortalLayout`; shared portal types remain defined by mc-kernel.
- `woodland-mansion-single-chunk` is a `CompactStructureKind` included in `NaturalStructureKind`. It keeps its blocks and markers in one chunk; the existing `woodland-mansion` kind may span chunks.
- Natural-structure region planners return a typed `Result` containing an `Option`. Invalid regions or unrepresentable structure footprints return `InvalidNaturalStructureCoordinate`; a valid region with no candidate returns `Success(None)`.
- `emptyBlocks`, `setBlockAt`, and type `SubscriberId` are exported from `@nerima-games/mc-worldgen/testing`, not from the production package root.

## Natural-structure coordinate failures

Region coordinates are plain numbers, not chunk coordinates. Planners validate that both region indices are safe integers and that each candidate structure's derived block-coordinate bounds are representable as safe integers before branding coordinates or sampling terrain.

`InvalidNaturalStructureCoordinate` is exported from the package root. Its failure value identifies the structure kind, region, coordinate axis, and invalid value:

```ts
type InvalidNaturalStructureCoordinate = {
  readonly _tag: 'InvalidNaturalStructureCoordinate'
  readonly axis: 'region-x' | 'region-z' | 'footprint-x' | 'footprint-y' | 'footprint-z'
  readonly kind: NaturalStructureKind
  readonly region: { readonly x: number; readonly z: number }
  readonly value: number
}
```

The `*ForRegion` planners and `planNaturalStructureForRegion` return `Result<Option<NaturalStructurePlan>, InvalidNaturalStructureCoordinate>`. The direct `villageSiteForRegion` and `strongholdSiteForRegion` selectors use the same result shape for their site type. A valid region without a candidate is `Success(None)`; invalid input or an unsafe derived footprint is `Failure(InvalidNaturalStructureCoordinate)`.

`naturalStructurePlansForChunk` returns a `Result` containing the candidate plans. `generateChunk`, `generateNetherChunk`, `generateEndChunk`, and their `*At` forms propagate the same coordinate failure. Generated `ChunkSource` values carry it in the Effect error channel, and `ChunkStoreError` includes it when a generated source fails.

The chunk-scoped queries return these results. The near queries search bounds extending from the requested chunk: villages use a fixed internal margin, while strongholds use a caller-supplied `halfExtent` margin in blocks.

- `villageSitesNearChunk`: `Result.Result<ReadonlyArray<VillageSite>, InvalidNaturalStructureCoordinate>`.
- `strongholdSitesNearChunk`: `Result.Result<ReadonlyArray<StrongholdSite>, InvalidNaturalStructureCoordinate>`.
- `villageVillagerSpawnsForChunk`: `Result.Result<ReadonlyArray<VillageVillagerSpawn>, InvalidNaturalStructureCoordinate>`.

`strongholdSitesNearChunk` requires `halfExtent` to be a nonnegative safe integer. An invalid value returns `Failure(InvalidNaturalStructureCoordinate)`.

`Failure(InvalidNaturalStructureCoordinate)` reports an invalid chunk coordinate or an unrepresentable derived coordinate. `Success([])` means the valid query found no sites or spawns.

The End feature API is separate from natural-structure region planning. `endFeaturePlanForSeed` returns an `EndFeaturePlan` for spikes; `createEndGatewayPlacement`, `resolveEndGatewayExit`, and `knownEndGatewayExit` cover gateway placement and travel.

## Store services and persistence

`ChunkCapacity` is required by `makeChunkStore(source, capacity)` and the store layers. The in-memory `ChunkStoreRegistryLayer(sourceForDimension, capacity)` creates one store per dimension.

`PersistentChunkStoreRegistryLayer(sourceForDimension, worldId, capacity)` takes the world ID as a function argument and requires `StoragePort` from `@nerima-games/mc-save` in its Effect layer environment. Import `ChunkStoreRegistry` and the layer constructors from the mc-worldgen package root. The service key `@nerima-games/mc-worldgen/ChunkStoreRegistry` is an Effect service identifier, not a package subpath. The [dimension-store migration example](./migration-0.6.0.md#select-a-store-by-dimension) shows how to provide the layer.

`ChunkStoreApi.prepare(edits)` validates a nonempty array of edits, safe-integer world positions, valid block IDs, unique positions, in-world Y values, and a resident chunk at every position. It fails with `ChunkWriteInvalidBatch` or `ChunkWriteChunkUnavailable`; a failure leaves the store unchanged. `ChunkWriteInvalidBatch.reason` distinguishes `empty`, `not-array`, `invalid-edit`, `invalid-position`, `invalid-block-id`, `duplicate-position`, and `out-of-world`. Its `PreparedChunkWrite.changes` contains only blocks that would actually change, each with its position and previous and next block IDs.

`ChunkStoreApi.prepare(edits)` records the store-local revision of each changed chunk. `ChunkStoreApi.publish(prepared)` compares every recorded revision with the current revision before applying any edit; it fails with `ChunkWriteStale` if any changed chunk differs or is no longer resident. A stale multi-chunk batch changes no chunks, light data, dirty notifications, or revisions. `ChunkWriteStale` includes the chunk `key`, `expectedRevision`, and `actualRevision`; `actualRevision` is `undefined` if the chunk is no longer resident. `ChunkWriteTokenInvalid` reports `foreign_store`, `already_published`, or `unknown_token`. These revisions guard one store; callers must coordinate transactions spanning multiple stores or dimensions. `setBlock` remains available for single edits.

`load`, `peek`, and `neighbours` return live chunk references typed as `ReadonlyChunk`. `getBlockAt` and `biomeAt` accept this readonly view. Published writes copy each changed chunk's block buffer, so earlier read references retain their values. Readonly is a TypeScript guarantee only: JavaScript can still mutate a live chunk object or its `Uint16Array`, bypassing dirty notifications and light invalidation. Callers must treat these references as immutable. `snapshot` returns a detached `Chunk` copy.

For complete call examples, see [Provide a chunk-store capacity](./migration-0.6.0.md#provide-a-chunk-store-capacity) and [Select a store by dimension](./migration-0.6.0.md#select-a-store-by-dimension).
