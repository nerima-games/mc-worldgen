# API lock — @nerima-games/mc-worldgen

<!-- ------------------------------------------------------------------------- -->
<!-- GENERATED FILE. Do not edit by hand.                                      -->
<!--                                                                           -->
<!-- Regenerate with `pnpm api:update`. `pnpm api:check`, which `pnpm verify`  -->
<!-- runs, fails when this file is stale.                                      -->
<!--                                                                           -->
<!-- Every line below is part of the published surface of this package. A diff -->
<!-- here is a diff in what consumers can see, and is the thing plan.md §6     -->
<!-- Step 0-3 asks to be reviewed as a diff. See scripts/api-lock.ts for how   -->
<!-- it is produced and why it is produced this way.                           -->
<!-- ------------------------------------------------------------------------- -->

format: 1
exported declarations: 144
supporting declarations: 2

## Exported

### AIR_BLOCK_ID  `const`

```ts
const AIR_BLOCK_ID: BlockId;
```

### BEDROCK_Y  `const`

```ts
const BEDROCK_Y = 0;
```

### BIOMES  `const`

```ts
const BIOMES: readonly ["OCEAN", "BEACH", "DESERT", "SAVANNA", "PLAINS", "FOREST", "TAIGA", "SNOW"];
```

### BIOME_SURFACES  `const`

```ts
const BIOME_SURFACES: Record<BiomeType, BiomeSurface>;
```

### BIOME_TREE_DENSITY  `const`

```ts
const BIOME_TREE_DENSITY: Record<BiomeType, number>;
```

### BLOCK  `const`

```ts
const BLOCK: {
    readonly AIR: BlockId;
    readonly BEDROCK: BlockId;
    readonly STONE: BlockId;
    readonly DIRT: BlockId;
    readonly GRASS: BlockId;
    readonly SAND: BlockId;
    readonly WATER: BlockId;
    readonly SNOW: BlockId;
    readonly GRAVEL: BlockId;
    readonly LOG: BlockId;
    readonly LEAVES: BlockId;
};
```

### BLOCK_ID_MAX  `const`

```ts
const BLOCK_ID_MAX = 255;
```

### BLOCK_OPACITIES  `const`

```ts
const BLOCK_OPACITIES: readonly ["transparentSolid", "fluid", "opaque"];
```

### BiomeSurface  `type`

```ts
type BiomeSurface = {
    readonly top: BlockId;
    readonly filler: BlockId;
    readonly underwaterTop: BlockId;
};
```

### BiomeType  `type`

```ts
type BiomeType = (typeof BIOMES)[number];
```

### BlockAxis  `const`

```ts
const BlockAxis: Brand.Brand.Constructor<BlockAxis>;
```

### BlockAxis  `type`

```ts
type BlockAxis = number & Brand.Brand<'BlockAxis'>;
```

### BlockId  `const`

```ts
const BlockId: Brand.Brand.Constructor<BlockId>;
```

### BlockId  `type`

```ts
type BlockId = number & Brand.Brand<'BlockId'>;
```

### BlockOpacity  `type`

```ts
type BlockOpacity = (typeof BLOCK_OPACITIES)[number];
```

### BlockPosition  `type`

```ts
type BlockPosition = {
    readonly x: BlockAxis;
    readonly y: BlockAxis;
    readonly z: BlockAxis;
};
```

### BlockReading  `type`

```ts
type BlockReading = {
    readonly _tag: 'Block';
    readonly block: BlockId;
} | {
    readonly _tag: 'ChunkNotLoaded';
} | {
    readonly _tag: 'OutOfWorld';
};
```

### BlockWriteOutcome  `type`

```ts
type BlockWriteOutcome = {
    readonly _tag: 'Written';
    readonly previous: BlockId;
    readonly chunk: ChunkCoord;
} | {
    readonly _tag: 'Unchanged';
    readonly previous: BlockId;
} | {
    readonly _tag: 'ChunkNotLoaded';
} | {
    readonly _tag: 'OutOfWorld';
};
```

### CAVE_CEILING_Y  `const`

```ts
const CAVE_CEILING_Y = 58;
```

### CAVE_FLOOR_Y  `const`

```ts
const CAVE_FLOOR_Y = 6;
```

### CAVE_THRESHOLD  `const`

```ts
const CAVE_THRESHOLD = 0.62;
```

### CHUNK_HEIGHT  `const`

```ts
const CHUNK_HEIGHT = 256;
```

### CHUNK_NOT_LOADED  `const`

```ts
const CHUNK_NOT_LOADED: BlockReading;
```

### CHUNK_SIZE_XZ  `const`

```ts
const CHUNK_SIZE_XZ = 16;
```

### CHUNK_VOLUME  `const`

```ts
const CHUNK_VOLUME: number;
```

### CONTINENTALNESS_CONTRAST  `const`

```ts
const CONTINENTALNESS_CONTRAST = 1.15;
```

### CarveOptions  `type`

```ts
type CarveOptions = {
    readonly waterFloorMargin?: number;
};
```

### Chunk  `type`

```ts
type Chunk = {
    readonly coord: ChunkCoord;
    readonly blocks: Uint8Array;
    readonly biomes: ReadonlyArray<BiomeType>;
};
```

### ChunkAxis  `const`

```ts
const ChunkAxis: Brand.Brand.Constructor<ChunkAxis>;
```

### ChunkAxis  `type`

```ts
type ChunkAxis = number & Brand.Brand<'ChunkAxis'>;
```

### ChunkCoord  `type`

```ts
type ChunkCoord = {
    readonly cx: ChunkAxis;
    readonly cz: ChunkAxis;
};
```

### ChunkDirtyBatch  `type`

```ts
type ChunkDirtyBatch = {
    readonly changed: ReadonlyArray<ChunkCoord>;
    readonly removed: ReadonlyArray<ChunkCoord>;
};
```

### ChunkDirtySubscription  `type`

```ts
type ChunkDirtySubscription = {
    readonly id: Store.SubscriberId;
    readonly drain: Effect.Effect<Store.ChunkDirtyBatch>;
    readonly unsubscribe: Effect.Effect<void>;
};
```

### ChunkKey  `type`

```ts
type ChunkKey = string & {
    readonly _tag: 'ChunkKey';
};
```

### ChunkLight  `type`

```ts
type ChunkLight = {
    readonly sky: Uint8Array;
    readonly block: Uint8Array;
};
```

### ChunkNeighbours  `type`

```ts
type ChunkNeighbours = {
    readonly xPos?: Chunk;
    readonly xNeg?: Chunk;
    readonly zPos?: Chunk;
    readonly zNeg?: Chunk;
};
```

### ChunkSource  `type`

```ts
type ChunkSource = (coord: ChunkCoord) => Effect.Effect<Chunk>;
```

### ChunkStore  `class`

```ts
class ChunkStore extends ChunkStore_base {
}
```

### ChunkStoreApi  `type`

```ts
type ChunkStoreApi = {
    readonly load: (coord: ChunkCoord) => Effect.Effect<Chunk>;
    readonly peek: (coord: ChunkCoord) => Effect.Effect<Chunk | undefined>;
    readonly snapshot: (coord: ChunkCoord) => Effect.Effect<Chunk | undefined>;
    readonly isLoaded: (coord: ChunkCoord) => Effect.Effect<boolean>;
    readonly loadedCoords: Effect.Effect<ReadonlyArray<ChunkCoord>>;
    readonly neighbours: (coord: ChunkCoord) => Effect.Effect<Store.ChunkNeighbours>;
    readonly unload: (coord: ChunkCoord) => Effect.Effect<boolean>;
    readonly getBlock: (position: BlockPosition) => Effect.Effect<Store.BlockReading>;
    readonly setBlock: (position: BlockPosition, block: BlockId) => Effect.Effect<Store.BlockWriteOutcome>;
    readonly getLight: (position: BlockPosition) => Effect.Effect<Store.LightReading>;
    readonly subscribeDirty: Effect.Effect<ChunkDirtySubscription>;
    readonly subscribeDirtyScoped: Effect.Effect<ChunkDirtySubscription, never, Scope>;
    readonly reset: Effect.Effect<void>;
};
```

### ChunkStoreLayer  `const`

```ts
const ChunkStoreLayer: (source: ChunkSource) => Layer.Layer<ChunkStore>;
```

### ChunkStoreState  `type`

```ts
type ChunkStoreState = {
    readonly loaded: ReadonlyMap<ChunkKey, Chunk>;
    readonly lights: ReadonlyMap<ChunkKey, ChunkLight>;
    readonly subscribers: ReadonlyMap<SubscriberId, DirtySubscriberState>;
    readonly nextSubscriberId: number;
};
```

### ClimateSample  `type`

```ts
type ClimateSample = {
    readonly temperature: number;
    readonly humidity: number;
};
```

### DEFAULT_TERRAIN_LEVELS  `const`

```ts
const DEFAULT_TERRAIN_LEVELS: TerrainLevels;
```

### DirtySubscriberState  `type`

```ts
type DirtySubscriberState = {
    readonly changed: ReadonlySet<ChunkKey>;
    readonly removed: ReadonlySet<ChunkKey>;
};
```

### EMPTY_DIRTY_BATCH  `const`

```ts
const EMPTY_DIRTY_BATCH: ChunkDirtyBatch;
```

### FALLBACK_BIOME  `const`

```ts
const FALLBACK_BIOME: BiomeType;
```

### GenerateOptions  `type`

```ts
type GenerateOptions = {
    readonly terrainLevels?: TerrainLevels;
    readonly carve?: CarveOptions;
    readonly decorate?: boolean;
};
```

### GeneratedChunkStoreLayer  `const`

```ts
const GeneratedChunkStoreLayer: (seed: number, options?: GenerateOptions) => Layer.Layer<ChunkStore>;
```

### LAKE_LEVEL  `const`

```ts
const LAKE_LEVEL = 63;
```

### LIGHT_BYTE_LENGTH  `const`

```ts
const LIGHT_BYTE_LENGTH: number;
```

### LIGHT_CHUNK_NOT_LOADED  `const`

```ts
const LIGHT_CHUNK_NOT_LOADED: LightReading;
```

### LIGHT_LEVEL_MAX  `const`

```ts
const LIGHT_LEVEL_MAX = 15;
```

### LIGHT_LEVEL_MIN  `const`

```ts
const LIGHT_LEVEL_MIN = 0;
```

### LIGHT_OUT_OF_WORLD  `const`

```ts
const LIGHT_OUT_OF_WORLD: LightReading;
```

### LightReading  `type`

```ts
type LightReading = {
    readonly _tag: 'Light';
    readonly sky: number;
    readonly block: number;
} | {
    readonly _tag: 'ChunkNotLoaded';
} | {
    readonly _tag: 'OutOfWorld';
};
```

### LocalAxis  `const`

```ts
const LocalAxis: Brand.Brand.Constructor<LocalAxis>;
```

### LocalAxis  `type`

```ts
type LocalAxis = number & Brand.Brand<'LocalAxis'>;
```

### LocalBlockCoord  `type`

```ts
type LocalBlockCoord = {
    readonly lx: LocalAxis;
    readonly ly: BlockAxis;
    readonly lz: LocalAxis;
};
```

### MAX_SURFACE_Y  `const`

```ts
const MAX_SURFACE_Y = 92;
```

### MIN_SURFACE_Y  `const`

```ts
const MIN_SURFACE_Y = 38;
```

### OUT_OF_WORLD  `const`

```ts
const OUT_OF_WORLD: BlockReading;
```

### SEA_LEVEL  `const`

```ts
const SEA_LEVEL = 63;
```

### SubscriberId  `type`

```ts
type SubscriberId = number & {
    readonly _tag: 'SubscriberId';
};
```

### TREE_CELL_JITTER_ORIGIN  `const`

```ts
const TREE_CELL_JITTER_ORIGIN: number;
```

### TREE_CELL_JITTER_SPAN  `const`

```ts
const TREE_CELL_JITTER_SPAN = 3;
```

### TREE_CELL_JITTER_X_SCALE  `const`

```ts
const TREE_CELL_JITTER_X_SCALE = 3.97;
```

### TREE_CELL_JITTER_Z_SCALE  `const`

```ts
const TREE_CELL_JITTER_Z_SCALE = 5.23;
```

### TREE_CROWN_RADIUS  `const`

```ts
const TREE_CROWN_RADIUS = 2;
```

### TREE_DENSITY_ROLL_RNG_SCALE  `const`

```ts
const TREE_DENSITY_ROLL_RNG_SCALE = 2.61;
```

### TREE_GRID_AREA  `const`

```ts
const TREE_GRID_AREA: number;
```

### TREE_GRID_SIZE  `const`

```ts
const TREE_GRID_SIZE = 8;
```

### TREE_MIN_SPACING  `const`

```ts
const TREE_MIN_SPACING: number;
```

### TREE_RNG_AMPLITUDE  `const`

```ts
const TREE_RNG_AMPLITUDE = 43758.5453;
```

### TREE_RNG_X_SCALE  `const`

```ts
const TREE_RNG_X_SCALE = 127.1;
```

### TREE_RNG_Z_SCALE  `const`

```ts
const TREE_RNG_Z_SCALE = 311.7;
```

### TerrainLevels  `type`

```ts
type TerrainLevels = {
    readonly seaLevel: number;
    readonly lakeLevel: number;
};
```

### TreeCandidate  `type`

```ts
type TreeCandidate = {
    readonly worldX: number;
    readonly worldZ: number;
    readonly cellRng: number;
};
```

### WATER_FLOOR_MARGIN  `const`

```ts
const WATER_FLOOR_MARGIN = 3;
```

### WRITE_CHUNK_NOT_LOADED  `const`

```ts
const WRITE_CHUNK_NOT_LOADED: BlockWriteOutcome;
```

### WRITE_OUT_OF_WORLD  `const`

```ts
const WRITE_OUT_OF_WORLD: BlockWriteOutcome;
```

### biomeAt  `const`

```ts
const biomeAt: (chunk: Chunk, lx: number, lz: number) => BiomeType;
```

### biomeFor  `const`

```ts
const biomeFor: (seed: number, wx: number, wz: number, surfaceY: number, levels: TerrainLevels) => BiomeType;
```

### blockAt  `const`

```ts
const blockAt: (state: ChunkStoreState, position: BlockPosition) => BlockReading;
```

### blockIndex  `const`

```ts
const blockIndex: (x: number, y: number, z: number) => number;
```

### blockPosition  `const`

```ts
const blockPosition: (x: number, y: number, z: number) => BlockPosition;
```

### blockPositionOfChunkLocal  `const`

```ts
const blockPositionOfChunkLocal: (chunk: ChunkCoord, local: LocalBlockCoord) => BlockPosition;
```

### blockReading  `const`

```ts
const blockReading: (block: BlockId) => BlockReading;
```

### carveCaves  `const`

```ts
const carveCaves: (blocks: Uint8Array, seed: number, coord: ChunkCoord, options?: CarveOptions) => void;
```

### cellOf  `const`

```ts
const cellOf: (worldCoordinate: number) => number;
```

### channelSeed  `const`

```ts
const channelSeed: (seed: number, channel: string) => number;
```

### chunkCoord  `const`

```ts
const chunkCoord: (cx: number, cz: number) => ChunkCoord;
```

### chunkCoordOfBlock  `const`

```ts
const chunkCoordOfBlock: (value: BlockPosition) => ChunkCoord;
```

### chunkCoordOfKey  `const`

```ts
const chunkCoordOfKey: (key: ChunkKey) => ChunkCoord;
```

### chunkKeyOf  `const`

```ts
const chunkKeyOf: (coord: ChunkCoord) => ChunkKey;
```

### chunkSnapshotOf  `const`

```ts
const chunkSnapshotOf: (chunk: Chunk) => Chunk;
```

### clampLightLevel  `const`

```ts
const clampLightLevel: (value: number) => number;
```

### classifyBiome  `const`

```ts
const classifyBiome: (climate: ClimateSample) => BiomeType;
```

### climateAt  `const`

```ts
const climateAt: (seed: number, wx: number, wz: number) => {
    readonly temperature: number;
    readonly humidity: number;
};
```

### columnIndex  `const`

```ts
const columnIndex: (lx: number, lz: number) => number;
```

### computeChunkLight  `const`

```ts
const computeChunkLight: (chunk: Chunk) => ChunkLight;
```

### computeWaterFloorYs  `const`

```ts
const computeWaterFloorYs: (blocks: Uint8Array, margin: number) => Int16Array;
```

### drained  `const`

```ts
const drained: (state: ChunkStoreState, id: SubscriberId) => readonly [ChunkDirtyBatch, ChunkStoreState];
```

### emptyBlocks  `const`

```ts
const emptyBlocks: () => Uint8Array;
```

### emptyChunkLight  `const`

```ts
const emptyChunkLight: () => ChunkLight;
```

### emptyChunkStoreState  `const`

```ts
const emptyChunkStoreState: ChunkStoreState;
```

### fbm2D  `const`

```ts
const fbm2D: (seed: number, x: number, z: number, options: {
    readonly octaves: number;
    readonly frequency: number;
    readonly persistence: number;
}) => number;
```

### generateChunk  `const`

```ts
const generateChunk: (seed: number, coord: ChunkCoord, options?: GenerateOptions) => Chunk;
```

### generateChunkAt  `const`

```ts
const generateChunkAt: (seed: number, x: number, z: number, options?: GenerateOptions) => Chunk;
```

### generatedChunkSource  `const`

```ts
const generatedChunkSource: (seed: number, options?: GenerateOptions) => ChunkSource;
```

### getBlockAt  `const`

```ts
const getBlockAt: (chunk: Chunk, lx: number, y: number, lz: number) => number;
```

### getLightAt  `const`

```ts
const getLightAt: (grid: Uint8Array, voxel: number) => number;
```

### isWorldY  `const`

```ts
const isWorldY: (y: number) => boolean;
```

### latticeValue  `const`

```ts
const latticeValue: (seed: number, x: number, z: number) => number;
```

### lightAt  `const`

```ts
const lightAt: (state: ChunkStoreState, position: BlockPosition) => readonly [LightReading, ChunkStoreState];
```

### lightEmissionOfBlockId  `const`

```ts
const lightEmissionOfBlockId: (id: number) => number;
```

### lightReading  `const`

```ts
const lightReading: (sky: number, block: number) => LightReading;
```

### localCoordOfBlock  `const`

```ts
const localCoordOfBlock: (value: BlockPosition) => LocalBlockCoord;
```

### makeChunkStore  `const`

```ts
const makeChunkStore: (source: ChunkSource) => Effect.Effect<ChunkStoreApi>;
```

### mulberry32  `const`

```ts
const mulberry32: (seed: number) => (() => number);
```

### neighboursOf  `const`

```ts
const neighboursOf: (state: ChunkStoreState, coord: ChunkCoord) => ChunkNeighbours;
```

### opacityOfBlockId  `const`

```ts
const opacityOfBlockId: (id: number) => BlockOpacity;
```

### packPosLevel  `const`

```ts
const packPosLevel: (x: number, y: number, z: number, level: number) => number;
```

### readBlock  `const`

```ts
const readBlock: (blocks: Uint8Array, index: number) => number;
```

### residentChunk  `const`

```ts
const residentChunk: (state: ChunkStoreState, coord: ChunkCoord) => Chunk | undefined;
```

### residentCoords  `const`

```ts
const residentCoords: (state: ChunkStoreState) => ReadonlyArray<ChunkCoord>;
```

### setBlockAt  `const`

```ts
const setBlockAt: (blocks: Uint8Array, lx: number, y: number, lz: number, block: BlockId) => void;
```

### setLightAt  `const`

```ts
const setLightAt: (grid: Uint8Array, voxel: number, level: number) => void;
```

### shouldPlaceTree  `const`

```ts
const shouldPlaceTree: (input: {
    readonly worldX: number;
    readonly worldZ: number;
    readonly surfaceY: number;
    readonly biome: BiomeType;
    readonly terrainLevels: TerrainLevels;
}) => boolean;
```

### subscribed  `const`

```ts
const subscribed: (state: ChunkStoreState) => readonly [SubscriberId, ChunkStoreState];
```

### surfaceHeightAt  `const`

```ts
const surfaceHeightAt: (seed: number, wx: number, wz: number) => number;
```

### transmitsLight  `const`

```ts
const transmitsLight: (id: number) => boolean;
```

### treeCellCandidate  `const`

```ts
const treeCellCandidate: (cellX: number, cellZ: number) => TreeCandidate;
```

### unpackLevel  `const`

```ts
const unpackLevel: (packed: number) => number;
```

### unpackX  `const`

```ts
const unpackX: (packed: number) => number;
```

### unpackY  `const`

```ts
const unpackY: (packed: number) => number;
```

### unpackZ  `const`

```ts
const unpackZ: (packed: number) => number;
```

### unsubscribed  `const`

```ts
const unsubscribed: (state: ChunkStoreState, id: SubscriberId) => ChunkStoreState;
```

### valueNoise2D  `const`

```ts
const valueNoise2D: (seed: number, x: number, z: number, frequency: number) => number;
```

### wasWritten  `const`

```ts
const wasWritten: (outcome: BlockWriteOutcome) => boolean;
```

### withBlockAt  `const`

```ts
const withBlockAt: (state: ChunkStoreState, position: BlockPosition, block: BlockId) => readonly [BlockWriteOutcome, ChunkStoreState];
```

### withChunk  `const`

```ts
const withChunk: (state: ChunkStoreState, chunk: Chunk) => ChunkStoreState;
```

### withoutChunk  `const`

```ts
const withoutChunk: (state: ChunkStoreState, coord: ChunkCoord) => readonly [boolean, ChunkStoreState];
```

### worldX  `const`

```ts
const worldX: (coord: ChunkCoord, lx: number) => number;
```

### worldZ  `const`

```ts
const worldZ: (coord: ChunkCoord, lz: number) => number;
```

## Supporting declarations

Not exported from the barrel, but named by the signatures above, so a
consumer is exposed to them. `Context.Tag` service classes emit their real
type onto one of these.

### ChunkStore_base  `const`

```ts
const ChunkStore_base: Context.TagClass<ChunkStore, "@nerima-games/mc-worldgen/ChunkStore", ChunkStoreApi>;
```

### Scope  `type`

```ts
type Scope = import('effect').Scope.Scope;
```
