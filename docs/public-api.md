# Public API

## mc-worldgen public surface

Import production mc-worldgen APIs from the package root. Testing utilities are at `@nerima-games/mc-worldgen/testing`. For seed and coordinate constructors and validation, see [validate world seeds](./migration-0.6.0.md#validate-world-seeds) and [validate raw coordinates](./migration-0.6.0.md#validate-coordinates-at-raw-input-boundaries).

`Result.Result<A, E>` is an `effect` result with `Success(A)` or `Failure(E)`; `Option.Option<A>` is `Some(A)` or `None`. A typed error in an `Effect.Effect<A, E, R>` is reported through the Effect error channel.

- Generation APIs accept mc-noise's `NoiseSeed`. The package root re-exports it. Validate external numbers with `NoiseSeed.result`; fractional values, `NaN`, infinities, and integers outside the safe-integer range fail. Valid integer seeds retain their generated output.
- Coordinates use mc-kernel brands. `ChunkCoord` contains `ChunkAxis` values, block positions use `BlockAxis`, and chunk-local horizontal positions use `LocalAxis`.
- Every chunk-store factory and layer requires a positive safe-integer `ChunkCapacity`. A full store evicts its least recently used clean chunk. Dirty chunks are persisted before eviction; a failed save leaves the chunk resident and returns a typed error.
- `ChunkStoreRegistry` provides an independent bounded `ChunkStoreApi` for each dimension. Its renderer-facing reads are `peek`, `neighbours`, `subscribeDirty`, and `getLight`.
- The package root exports `Chunk`, `ChunkWithBlockStates`, `ReadonlyChunk`, `ReadonlyChunkWithBlockStates`, `ReadonlyUint16Array`, `ReadonlyUint32Array`, `ChunkDirtyBatch`, `ChunkDirtyChunk`, `ChunkLocalAabb`, `ChunkIntegrityFailure`, and `ChunkIntegritySection`. It also re-exports the `BlockStateValues` and `BlockStateCodecFailure` types from mc-kernel. `ChunkNeighbours`, `LightReading`, `CHUNK_HEIGHT`, and `chunkKeyOf` are exported too. `chunkKeyOf` returns mc-kernel's branded `ChunkKey`; import the `ChunkKey` type from mc-kernel.
- The package root exports `detectNetherPortal` and `generatePortalLayout`; shared portal types remain defined by mc-kernel.
- `woodland-mansion-single-chunk` is a `CompactStructureKind` included in `NaturalStructureKind`. It keeps its blocks and markers in one chunk; the existing `woodland-mansion` kind may span chunks.
- Natural-structure region planners return a typed `Result` containing an `Option`. Invalid regions or unrepresentable structure footprints return `InvalidNaturalStructureCoordinate`; a valid region with no candidate returns `Success(None)`.
- `emptyBlocks`, `setBlockAt`, and type `SubscriberId` are exported from `@nerima-games/mc-worldgen/testing`, not from the production package root.

## Natural-structure coordinate failures

Region coordinates are plain-number region indices, not chunk coordinates. Planners validate that both indices are safe integers and that each candidate structure's derived block-coordinate bounds are representable as safe integers before branding coordinates or sampling terrain.

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

The chunk-scoped queries return these results. The near queries search bounds extending from the requested chunk: village sites use an internal 30-block half extent, while strongholds use a caller-supplied `halfExtent` margin in blocks.

- `villageSitesNearChunk`: `Result.Result<ReadonlyArray<VillageSite>, InvalidNaturalStructureCoordinate>`.
- `strongholdSitesNearChunk`: `Result.Result<ReadonlyArray<StrongholdSite>, InvalidNaturalStructureCoordinate>`.
- `villageVillagerSpawnsForChunk`: `Result.Result<ReadonlyArray<VillageVillagerSpawn>, InvalidNaturalStructureCoordinate>`.

`strongholdSitesNearChunk` requires `halfExtent` to be a nonnegative safe integer. An invalid value returns `Failure(InvalidNaturalStructureCoordinate)`.

`InvalidNaturalStructureCoordinate.axis` identifies an invalid region index (`region-x` or `region-z`) or an unrepresentable derived footprint coordinate (`footprint-x`, `footprint-y`, or `footprint-z`). `Success([])` means the valid query found no sites or spawns.

The End feature API is separate from natural-structure region planning. `endFeaturePlanForSeed` returns an `EndFeaturePlan` for spikes; `createEndGatewayPlacement`, `resolveEndGatewayExit`, and `knownEndGatewayExit` cover gateway placement and travel.

## Store services and persistence

`ChunkCapacity` is required by `makeChunkStore(source, capacity)` and the store layers. `ChunkStoreRegistryLayer(sourceForDimension, capacity)` provides the in-memory registry.

`PersistentChunkStoreRegistryLayer(sourceForDimension, worldId, capacity)` takes the world ID as a function argument and requires `StoragePort` from `@nerima-games/mc-save` in its Effect layer environment. The service key `@nerima-games/mc-worldgen/ChunkStoreRegistry` is an Effect service identifier, not a package subpath. The [dimension-store migration example](./migration-0.6.0.md#select-a-store-by-dimension) shows how to provide the layer.

`ChunkStoreApi.prepare(edits)` accepts `{ position, block, state? }` edits and validates a nonempty array, safe-integer world positions, valid block IDs and states, unique positions, in-world Y values, and a resident chunk at every position. If `state` is omitted, the edit uses the kernel default state for its block ID. It fails with `ChunkWriteInvalidBatch`, `ChunkWriteChunkUnavailable`, or `BlockStateCodecFailure`; a failure leaves the store unchanged. `ChunkWriteInvalidBatch.reason` distinguishes `empty`, `not-array`, `invalid-edit`, `invalid-position`, `invalid-block-id`, `duplicate-position`, and `out-of-world`. Its `PreparedChunkWrite.changes` lists positions where a block ID or state changes, with the previous and next block IDs. The change entry does not include state codes, so a state-only edit has equal previous and next block IDs.

`ChunkStoreApi.prepare(edits)` records the store-local revision of each changed chunk. `ChunkStoreApi.publish(prepared)` compares every recorded revision with the current revision before applying any edit; it fails with `ChunkWriteStale` if any changed chunk differs or is no longer resident. A stale multi-chunk batch changes no chunks, light data, dirty notifications, or revisions. A `ChunkWriteStale` failure does not consume the token; publishing that token again still fails as stale, so callers must prepare again. `ChunkWriteStale` includes the chunk `key`, `expectedRevision`, and `actualRevision`; `actualRevision` is `undefined` if the chunk is no longer resident. `ChunkWriteTokenInvalid` reports `foreign_store`, `already_published`, or `unknown_token`. These revisions guard one store; callers must coordinate transactions spanning multiple stores or dimensions.

`load`, `peek`, and present entries in `neighbours` return live chunk references typed as `ReadonlyChunkWithBlockStates`; that view always has one `blockStates` code per block. `snapshot` returns a detached `ChunkWithBlockStates` copy. The root-level `getBlockAt` and `biomeAt` readers accept the readonly chunk shape. Published writes copy each changed chunk's block and state buffers, so earlier read references retain their values. Readonly is a TypeScript guarantee only: JavaScript can still mutate a live chunk object or its `Uint16Array` and `Uint32Array`, bypassing dirty notifications and light invalidation. Callers must treat these references as immutable.

`setBlock(position, block, state?)` uses the kernel default state for `block` when `state` is omitted. A change to either the block ID or its state returns `Written` and marks the local block dirty; state-only changes do not trigger light updates because the block ID is unchanged. Invalid state values fail through the Effect error channel with `BlockStateCodecFailure`; light queue invariant failures use `LightQueueUnderflowError`.

`withBlockAt(state: ChunkStoreState, position: BlockPosition, block: BlockId, stateValues?: BlockStateValues)` is the package-root store-state transition with the same default-state and state-only update rules. `BlockPosition` and `BlockId` are imported from mc-kernel. Its `Result` success is `[BlockWriteOutcome, ChunkStoreState]`; the outcome is `Written` (previous block ID and chunk), `Unchanged` (previous block ID), `ChunkNotLoaded`, or `OutOfWorld`. Its error type includes `BlockStateCodecFailure` and `LightQueueUnderflowError`.

`ChunkDirtySubscription.drain` returns a `ChunkDirtyBatch`. Its `changed` array contains `ChunkDirtyChunk` values, combining a `ChunkCoord` with a `ChunkLocalAabb`; `removed` remains an array of `ChunkCoord`. The AABB's `min` and `max` are readonly three-element tuples in X/Y/Z order, in chunk-local block coordinates. The minimum is inclusive and the maximum is exclusive. A block edit contributes its one-block box, and edits accumulated before `drain` are combined into one enclosing AABB for that chunk. Whole-chunk changes use the full chunk bounds.

Chunk-cache misses can perform up to four cold loads concurrently, including a persistence lookup or terrain generation. A separate single permit serializes chunk insertion and eviction.

Persistent chunk saves use `CHUNK_FORMAT` version 3. The `blocks` field remains base64-encoded `Uint16` block IDs in little-endian order. The required `blockStates` field is base64-encoded and contains one 32-bit unsigned state code per block in little-endian order; `blockStateCodecVersion` identifies kernel codec version 1. The `integrity` field has this shape:

```ts
{
  algorithm: 'fnv1a32',
  sections: {
    blocks: { byteLength: number, checksum: string },
    blockStates: { byteLength: number, checksum: string },
    biomes: { byteLength: number, checksum: string },
    structureMarkers: { byteLength: number, checksum: string },
  },
}
```

Each checksum is an eight-character lowercase hexadecimal FNV-1a32 value. The block and state checksums cover their little-endian bytes; the biome checksum covers its canonical JSON array; the marker checksum covers the ordered end-feature IDs and markers followed by natural-structure IDs and markers, with object keys sorted before UTF-8 encoding. On mismatch, the schema decoder returns a `SaveDecodeError` whose cause carries a `ChunkIntegrityFailure`; `chunkIntegrityFailureFromSaveDecodeError(error)` returns `Option.Option<ChunkIntegrityFailure>` for the section-tagged failure. `ChunkPersistenceError` exposes that `ChunkIntegrityFailure` directly. Decoding checks integrity before validating each state code against its block ID. mc-save's envelope integrity remains a separate whole-envelope check.

Version 1 saves stored `Uint8` block IDs, and version 2 stored `Uint16` block IDs; neither stored block states or chunk-section checksums. A v3 load checks all four saved section checksums. A v1/v2 load is a legacy migration with no section checksum to verify; the returned `ChunkWithBlockStates` carries no verification-provenance field. Both versions derive each block's kernel default state. Subsequent saves use version 3 with section checksums.

For a complete capacity example, see [Provide a chunk-store capacity](./migration-0.6.0.md#provide-a-chunk-store-capacity).
