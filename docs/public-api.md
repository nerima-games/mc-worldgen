# 公開 API

plan.md §3.7 が要求する API を、**参照実装の実コードと突き合わせて**確定させたもの。
根拠パスは全て `ts-minecraft` リポジトリ内の実在するファイル・行である。

## 0. plan.md が要求している API

> **主要な公開 API**: `generateChunk(seed, coords) → Chunk`（純粋・決定論）、
> `BiomeService`（気候→バイオーム）、`ChunkManager`（ロード/アンロード/ダーティフラグ）、
> ワーカープール Port（実装は利用側が注入）

---

<a id="levels"></a>
## 1. 地形定数 — **plan.md の値は誤り**

```typescript
export const SEA_LEVEL = 63          // NOT 48
export const LAKE_LEVEL = SEA_LEVEL  // NOT 62、しかも独立した定数ではない

export type TerrainLevels = {
  readonly seaLevel: number
  readonly lakeLevel: number
}
export const DEFAULT_TERRAIN_LEVELS: TerrainLevels   // { seaLevel: 63, lakeLevel: 63 }
```

`domain/constants.ts`。根拠は `packages/core/domain/constants.ts:17` と `:20`。
詳細は [design-notes.md](./design-notes.md#dn-1)。

### 定数ではなく設定型として扱う

参照実装は `packages/world` 内でこの定数を**1 箇所でしか import していない**
（`domain/terrain/generator-types.ts:3`）。そこで `DEFAULT_TERRAIN_LEVELS`（`:15-18`）になり、
以降は既定引数として流れる:

```typescript
export const generateTerrain = (
  ...,
  terrainLevels: TerrainLevels = DEFAULT_TERRAIN_LEVELS,
): Effect.Effect<Chunk, never>
```
（`packages/world/domain/terrain/generator.ts:29-35`）

mc-worldgen も同じ形にしてある:

```typescript
export const generateChunk = (seed: number, coord: ChunkCoord, options?: {
  readonly terrainLevels?: TerrainLevels
  readonly carve?: CarveOptions
  readonly decorate?: boolean
}) => Chunk
```

`test/terrain-levels.test.ts` の
`honours a caller-supplied sea level rather than the baked constant` が固定している。

### チャンクレイアウト

```typescript
export const CHUNK_SIZE_XZ = 16
export const CHUNK_HEIGHT = 256
export const CHUNK_VOLUME = 65536
export const blockIndex: (x: number, y: number, z: number) => number
export const BEDROCK_Y = 0
export const WATER_FLOOR_MARGIN = 3
```

インデックス式は参照実装そのまま（`packages/world/domain/chunk.ts:11`）:

```
index = y + (z * CHUNK_HEIGHT) + (x * CHUNK_HEIGHT * CHUNK_SIZE)
```

Y が連続していることが本質である。柱を上下に走る処理
（表面探索・スカイライト伝播・水の充填）がキャッシュに乗る。
これらはチャンクごと柱ごとに走るので、最適化する価値のある軸はここである。

---

## 2. `generateChunk`

```typescript
export type ChunkCoord = { readonly x: number; readonly z: number }
export const chunkCoord: (x: number, z: number) => ChunkCoord

export type Chunk = {
  readonly coord: ChunkCoord
  readonly blocks: Uint8Array                    // CHUNK_VOLUME 個のブロック id
  readonly biomes: ReadonlyArray<BiomeType>      // 柱ごと。index = lz * 16 + lx
}

export const generateChunk: (seed: number, coord: ChunkCoord, options?: GenerateOptions) => Chunk
export const generateChunkAt: (seed: number, x: number, z: number, options?: GenerateOptions) => Chunk
```

`domain/terrain.ts`。**同期関数**である（`Effect` を返さない）。

参照実装も実質同期だった。`generateTerrainBlocks`
（`packages/world/application/terrain-generation.ts:120`）は
内部で `Effect.runSync` している（`:122`）。
パイプライン全体が `Effect.sync` / `Effect.succeed` なので安全である。

### 補助クエリ

```typescript
export const surfaceHeightAt: (seed: number, wx: number, wz: number) => number
export const climateAt: (seed: number, wx: number, wz: number)
  => { readonly temperature: number; readonly humidity: number }
export const biomeFor: (seed: number, wx: number, wz: number, surfaceY: number, levels: TerrainLevels)
  => BiomeType
```

`surfaceHeightAt` は「世界に対する最も安いクエリ」であり、
`ChunkManager` がチャンクを丸ごと生成せずにスポーン地点を選ぶために要る。

**`generateChunk` が実際に作るものと一致していなければならない。**
`test/determinism.test.ts` の
`surfaceHeightAt agrees with what generateChunk actually built` が固定している。

### 決定論とサンプリングの絶対座標性

サンプリングは**必ず絶対ワールド座標**で行う。チャンク相対ではない。
参照実装も同様（`terrain/generator.ts:39-40` で
`baseWorldX = coord.x * CHUNK_SIZE` に変換してから渡す）。

隣接チャンクが同じワールド柱について同じ答えを得るので、
x = 16 の倍数に継ぎ目が出ない。

固定テスト:
`agrees about the surface height of a column shared by two chunks`、
`handles negative coordinates, where floor-vs-truncate bugs live`。

---

## 3. バイオーム分類

```typescript
export const BIOMES: readonly ['OCEAN', 'BEACH', 'DESERT', 'SAVANNA', 'PLAINS', 'FOREST', 'TAIGA', 'SNOW']
export type BiomeType = (typeof BIOMES)[number]

export type ClimateSample = { readonly temperature: number; readonly humidity: number }
export const classifyBiome: (climate: ClimateSample) => BiomeType
export const FALLBACK_BIOME: BiomeType   // 'PLAINS'

export type BiomeSurface = {
  readonly top: number
  readonly filler: number
  readonly underwaterTop: number
}
export const BIOME_SURFACES: Record<BiomeType, BiomeSurface>
export const BIOME_TREE_DENSITY: Record<BiomeType, number>
```

`domain/biome.ts`。ルールテーブル駆動・first-match-wins・`PLAINS` フォールバック。
参照実装の構造（`CLASSIFY_BIOME_RULES`,
`packages/world/domain/biome-classifier.ts:44-79`、フォールバック `:86`）と同じ。

テーブルにしてあるので「どの気候がどのバイオームにもならないか」
「到達不能なバイオームはどれか」がデータを読むだけで答えられる。

### 参照実装との差: 入力が 2 個 vs 6 個

**現状の mc-worldgen は 2 入力（temperature / humidity）版しか実装していない。**

参照実装のフル分類器は `ClimateSample` が **6 入力**である
（`biome-classifier.ts:16-23`）:
`temperature` / `humidity` / `continentalness` / `erosion` / `pv` / `riverNoise`。

`classifyBiomeFromClimate`（`:96`）の処理順:

1. 生の temp/humidity を分散ストレッチ（`:104-105`、`stretchClimate` は `:91`）
2. RIVER 帯の判定（`:107-109`）
3. 基本分類（`:111`）
4. `continentalness < -0.42` なら OCEAN（`:113`）
5. `mountaininess = max(0,pv)*0.65 + max(0,0.45-erosion)*0.35` から MOUNTAINS（`:120-123`）
6. SWAMP への降格（`:128`）
7. MOUNTAINS → TAIGA への降格（`:132`）
8. river ノイズチャンネルを再利用した FLOWER_FOREST の希少変種（`:139-141`）

BEACH は隣接バイオームを要する後処理である
（`refineBeachBiome` `:146`、`refineBeachBiomeFromAdjacent` `:156`）。

参照実装のバイオームは **13 種**（`packages/world/domain/biome.ts:4`）:
`PLAINS, DESERT, FOREST, FLOWER_FOREST, OCEAN, MOUNTAINS, SNOW, SWAMP, JUNGLE, BEACH, RIVER, TAIGA, SAVANNA`。

**地形の高さはバイオームに依存しない。**
`computeColumnYFromValues(continentalness, erosion, pv, jaggedness)`
（`packages/world/domain/density-function.ts:42-55`）がスプラインベースで決める（MC 1.18 方式）。
バイオームは表面材質と装飾を決めるだけである。

### `BiomeService`（未実装）

参照実装のタグは `@minecraft/application/BiomeService`
（`packages/world/application/biome-service.ts:7`）、5 メソッド:

```typescript
getTemperature: (x: number, z: number) => Effect.Effect<number, never>
getHumidity:    (x: number, z: number) => Effect.Effect<number, never>
getBiome:       (x: number, z: number) => Effect.Effect<BiomeType, never>
getBiomeProperties: (biome: BiomeType) => Effect.Effect<BiomeProperties, never, never>
getBiomesAndPropertiesForChunk: (chunkX: number, chunkZ: number)
  => Effect.Effect<ReadonlyArray<{ biome: BiomeType; props: BiomeProperties }>>
```

**ただしジェネレータが依存しているのはもっと狭い Port** である:
`BiomeGeneratorPort`（`packages/world/domain/biome-generator-port.ts:4-11`、3 メソッド）。

移植するならサービスではなく**この Port のほうを**移植すること。

---

## 4. カーバー

```typescript
export const CAVE_FLOOR_Y = 6
export const CAVE_CEILING_Y = 58
export const CAVE_THRESHOLD = 0.62

export type CarveOptions = { readonly waterFloorMargin?: number }

export const computeWaterFloorYs: (blocks: Uint8Array, margin: number) => Int16Array
export const carveCaves: (blocks: Uint8Array, seed: number, coord: ChunkCoord, options?: CarveOptions) => void
```

`domain/carver.ts`。**水域の床マージン検査を含む**。
これが最も重要な移植物である → [design-notes.md](./design-notes.md#dn-2)。

`carveCaves` は `blocks` を**破壊的に変更する**。
このプロジェクトの不変性選好に対する意図的な例外である:
チャンクバッファは 64KB で、パイプラインは複数パスを走る。
各パスでコピーすると、世界が広がったときにスタッターとして現れる種類のコストになる。
変更対象は呼び出し側が直前に確保しまだ共有していないバッファなので、
`generateChunk` の外からは観測できない。

`waterFloorMargin: 0` はガードを無効化する。**テスト専用の仕掛け**である
（バグを再現できない回帰テストは、今日のコードが今日のコードと等しいことしか主張しない）。

### パスの順序が重要

**水を入れてから彫る。** カーバーのガードは水ブロックを探して働くので、
先に彫るとガードが探すものが無くなり、黙って何もしなくなる。
失敗の現れ方はエラーではなく「微妙に中空な湖」である。

参照実装の順序はさらに込み入っている:
洞窟は装飾の**前**（`generator.ts:102`）、渓谷は木・草の**後**（`generator.ts:155`）。
理由は `:141-142` に書かれている
（渓谷の壁が鉱石と表層を「きれいに切る」ようにするため）。

---

## 5. 植生（木）

```typescript
export const TREE_GRID_SIZE = 4
export const TREE_GRID_AREA = 16
export const TREE_RNG_X_SCALE = 127.1
export const TREE_RNG_Z_SCALE = 311.7
export const TREE_RNG_AMPLITUDE = 43758.5453
export const TREE_CELL_JITTER_X_SCALE = 3.97
export const TREE_CELL_JITTER_Z_SCALE = 5.23
export const TREE_DENSITY_ROLL_RNG_SCALE = 2.61

export type TreeCandidate = { readonly worldX: number; readonly worldZ: number; readonly cellRng: number }
export const treeCellCandidate: (cellX: number, cellZ: number) => TreeCandidate
export const cellOf: (worldCoordinate: number) => number
export const shouldPlaceTree: (input: {
  readonly worldX: number
  readonly worldZ: number
  readonly surfaceY: number
  readonly biome: BiomeType
  readonly terrainLevels: TerrainLevels
}) => boolean
```

`domain/tree-placement.ts`。定数は全て
`packages/world/domain/terrain/tree-placer.config.ts:26-41` からの直接移植。

`treeCellCandidate` は `tree-placer.ts:169-179` の直訳である。
ジッターと密度ロールが**同じ `cellRng`** から別の乗数で導かれている点に注意
（セルあたりハッシュ評価 1 回）。

3 つのゲート（`tree-placer.ts:189-220`）:

1. この柱がセルのジッター候補と一致するか（`:211-214`）
2. セルの密度ロールが成功するか（`:215`）— **柱ごとではなくセルごとに 1 回**
3. 水没していないか（`:207`）

→ [design-notes.md](./design-notes.md#dn-4), [#dn-5](./design-notes.md#dn-5)

---

## 6. 未実装: `ChunkManager`

参照実装のタグは `@minecraft/application/ChunkManagerService`
（`packages/world/application/chunk-manager-service.ts:26`）。メソッド（`:65-86`）:

```typescript
setActiveWorldId: (worldId: WorldIdType) => Effect.Effect<void, never>
setActiveDimension: ...
getChunk: (coord: ChunkCoord) => Effect.Effect<Chunk, ChunkManagerError>
loadChunksAroundPlayer: (playerPos: Position, renderDistance?: number, options?: ChunkLoadOptions)
  => Effect.Effect<boolean, ChunkManagerError>
getLoadedChunks: () => ...
drainRenderDirtyChunks / drainRenderDirtyChunkEntries: () => ...
markChunkDirty: (coord: ChunkCoord,
  dirtyVoxels?: ReadonlyArray<{ readonly lx: number; readonly y: number; readonly lz: number }>) => ...
saveDirtyChunks: () => ...
unloadChunk: (coord: ChunkCoord) => Effect.Effect<void, StorageError>
```

ライフサイクル（`chunk-manager-ops.ts:125-132` に文書化されている）:

```
キャッシュ (LRU HashMap) → IndexedDB → 生成
```

入口は `getChunk`（`chunk-manager-ops.ts:133-137`）。
並行度は `Effect.makeSemaphore(4)` で制限（`chunk-manager-service.ts:45`）。

**注意**: `unloadChunk` の失敗型が `StorageError` である。
これが「mc-worldgen が mc-save に依存する」ことの具体的な現れである。

---

## 7. 未実装: ワーカープール Port

参照実装は `packages/worker/application/terrain-worker-pool-port.ts:35`（48 LOC）、
タグ `@minecraft/application/terrain/TerrainWorkerPoolPort`、**1 メソッド**:

```typescript
generateTerrain: (
  _coord: ChunkCoord,
  _options: TerrainGenerationOptions,
) => Effect.Effect<ChunkBlocks, TerrainGenerationError>

// :30-35
type TerrainGenerationOptions = Readonly<{
  seaLevel: number; lakeLevel: number; seed: number
  dimension?: 'overworld' | 'nether' | 'end'
}>
// :25-28
TerrainGenerationError = ... { reason, chunk }
```

ヘッダコメント（`:5-14`）が意図を明記している:
**アプリケーション層は「Worker か、プールか、同期実行か」を知ってはならない。**

この禁欲は維持する。実装は利用側（mc-render がワーカープール実装を持つ）が注入する。

### パリティテストを忘れないこと

参照実装には `packages/worker/test/terrain-worker-pool.parity.property.test.ts`（124 LOC）があり、
**Worker の出力がメインスレッドとバイト一致すること**を検証している。

これが無いと、Worker 経路だけで地形が変わるバグが本番でしか見つからない。

---

## 8. 未実装: ライトグリッド

plan.md §3.7:「ライトグリッド（BFS 光伝播、4bit パック）はチャンクデータの一部としてここが所有。
適用（描画）は mc-render」

**パック処理は `packages/world` ではなく `packages/block/domain/light.ts`（211 LOC）にある。**
移植時にパッケージ境界をまたぐ点に注意。

```
light.ts:4    // 4-bit-per-voxel light grids. Storage: Uint8Array of LIGHT_BYTE_LENGTH bytes;
              // 2 voxels per byte (low/high nibbles).
light.ts:5    LIGHT_LEVEL_MAX = 15
light.ts:7    LIGHT_BYTE_LENGTH = (CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT) / 2
light.ts:93-99   getLightAt: byteIdx = vi >> 1、(vi & 1) === 0 ? byte & 0x0f : (byte >> 4) & 0x0f
light.ts:100-108 setLightAt: 0..15 にクランプして該当ニブルへ
```

BFS 本体は `packages/world/domain`:

| LOC | ファイル | 役割 |
| ---: | --- | --- |
| 151 | `sky-light-bfs.ts` | `propagateSkyLightIncremental` (`:33`) |
| 132 | `block-light-bfs.ts` | `propagateBlockLightIncremental` (`:32`) |
| 76 | `light-engine-helpers.ts` | fresh / existing / incremental |
| 33 | `light-engine-model.ts` | `DirtyVoxel`、`BoundaryDirty`、`AABBAccumulator` |
| 30 | `light-engine-utils.ts` | キューのパック、AABB 追跡 |

どちらの BFS も **remove-then-add の 2 キュー方式**である
（`removalQueue` / `addQueue`、`sky-light-bfs.ts:40-41`、`block-light-bfs.ts:39-40`）。
これがインクリメンタル光伝播の正しいアルゴリズムである。

キューは int32 1 個にパックされる（`light-engine-utils.ts:22-26`）:

```typescript
packPosLevel = (x, y, z, lvl) => (x << 13) | (z << 9) | y | (lvl << 17)
// y: bit 0-8 (9bit, 0..511) / z: 9-12 / x: 13-16 / level: 17-21
```

`FULL_RECOMPUTE_THRESHOLD = 256`（`light-engine-utils.ts:6`）:
ダーティボクセルがこれを超えたらインクリメンタルを諦めて全再計算する。

チャンクをまたぐ伝播は `MutableBoundaryDirty` `{nx, px, nz, pz}` で報告し
（`light-engine-model.ts:24-29`）、触れた領域は AABB に集約して
再メッシュ範囲を絞る（`light-engine-utils.ts:15-19`）。

**重要**: 参照実装は skyLight / blockLight を**永続化していない**。
ロード時に `ctx.lightEngine.updateLight(baseChunk)` で再計算する
（`chunk-manager-ops-storage.ts:61`）。
チャンクフォーマットを `defineFormat` で定義するとき、この判断を引き継ぐか決めること。

なお `no-bitwise` は mc-worldgen の `oxlint.json` でのみ `off` にしてある。
シード PRNG とこのライトパックの両方が bit 演算を必要とするためで、理由はそこに書いてある。
