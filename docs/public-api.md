# Public API

## mc-worldgen 0.6 public surface

This document summarizes the consumer-facing changes in 0.6. It is not a complete inventory of package exports. Import public mc-worldgen APIs from the package root unless another entry point is shown. See the [migration guide](./migration-0.6.0.md) for input-validation examples.

- Generation APIs accept mc-noise's `NoiseSeed`. The package root re-exports it. Validate external numbers with `NoiseSeed.result`; fractional values, `NaN`, infinities, and integers outside the safe-integer range fail. Valid integer seeds retain their generated output.
- Coordinates use mc-kernel 0.9 brands. `ChunkCoord` contains `ChunkAxis` values, block positions use `BlockAxis`, and chunk-local horizontal positions use `LocalAxis`. The examples use the mc-kernel package root for constructors and types.
- Every chunk-store factory and layer requires a positive safe-integer `ChunkCapacity`. A full store evicts its least recently used clean chunk. Dirty chunks are persisted before eviction; a failed save leaves the chunk resident and returns a typed error.
- `ChunkStoreRegistry` provides an independent bounded `ChunkStoreApi` for each dimension. Its renderer-facing reads are `peek`, `neighbours`, `subscribeDirty`, and `getLight`.
- The package root exports `Chunk`, `ChunkNeighbours`, `LightReading`, `CHUNK_HEIGHT`, and `chunkKeyOf`. The latter is re-exported from mc-kernel and returns its branded `ChunkKey`; import the `ChunkKey` type from mc-kernel.
- The package root exports `detectNetherPortal` and `generatePortalLayout`; shared portal types remain defined by mc-kernel.
- `woodland-mansion-single-chunk` is a `CompactStructureKind` included in `NaturalStructureKind`. It keeps its blocks and markers in one chunk; the existing `woodland-mansion` kind may span chunks.
- Natural-structure region planners return a typed `Result` containing an `Option`. Invalid regions or unrepresentable structure footprints return `InvalidNaturalStructureCoordinate`; a valid region with no candidate returns `Success(None)`.
- `emptyBlocks`, `setBlockAt`, and type `SubscriberId` are exported from `@nerima-games/mc-worldgen/testing`, not from the production package root.

## Natural-structure coordinate failures

Region coordinates are plain numbers, not chunk coordinates. Planners validate that both region indices are safe integers and that the candidate footprint can be represented by safe block coordinates before branding or terrain sampling.

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

The chunk-scoped queries return these results:

- `villageSitesNearChunk`: `Result.Result<ReadonlyArray<VillageSite>, InvalidNaturalStructureCoordinate>`.
- `strongholdSitesNearChunk`: `Result.Result<ReadonlyArray<StrongholdSite>, InvalidNaturalStructureCoordinate>`.
- `villageVillagerSpawnsForChunk`: `Result.Result<ReadonlyArray<VillageVillagerSpawn>, InvalidNaturalStructureCoordinate>`.

`Failure(InvalidNaturalStructureCoordinate)` reports an invalid chunk coordinate or an unrepresentable derived coordinate. `Success([])` means the valid query found no sites or spawns.

The End spike and gateway APIs use `EndFeaturePlan` and gateway-specific values. They are separate from natural-structure region planning.

## Store services and persistence

`ChunkCapacity` is required by `makeChunkStore(source, capacity)` and the store layers. The in-memory `ChunkStoreRegistryLayer(sourceForDimension, capacity)` creates one store per dimension.

`PersistentChunkStoreRegistryLayer(sourceForDimension, worldId, capacity)` takes the world ID as a function argument and requires `StoragePort` in its Effect layer environment. Import `ChunkStoreRegistry` and the layer constructors from the mc-worldgen package root. The service key `@nerima-games/mc-worldgen/ChunkStoreRegistry` is an Effect service identifier, not a package subpath.

For complete call examples, see [Provide a chunk-store capacity](./migration-0.6.0.md#provide-a-chunk-store-capacity) and [Select a store by dimension](./migration-0.6.0.md#select-a-store-by-dimension).
