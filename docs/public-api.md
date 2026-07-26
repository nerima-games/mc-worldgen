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

## 6. `ChunkStore` — plan.md §3.7 の `ChunkManager`。**実装済み**

`application/chunk-store.ts`。タグは `@nerima-games/mc-worldgen/ChunkStore`。

### 6-0. なぜ mc-sim ではなくここなのか

**plan.md はブロック書き込み経路の所有者を決めていない。**
§3.7 は本リポジトリに `ChunkManager`（ロード / アンロード / **ダーティフラグ**）を与え、
§3.8 は mc-sim に「ゲーム状態の中枢」を与えている。両方とも基盤階層なので、
§2.3-1 の「基盤 = 名詞」は候補を 2 つに絞るだけで決着しない。

決め手は 4 つ、効き目の強い順に:

| # | 根拠 | 内容 |
| --- | --- | --- |
| 1 | plan.md §3.7 / §3.8 の**責務文** | §3.7 は「チャンクのライフサイクル管理」を名指しする。§3.8 の責務文は EntityManager / PlayerService / InventoryService / 体力 / 空腹 / XP / 実績 / 時間 / ゲームループ / 設定 / カメラ姿勢を挙げ、**ブロックもチャンクも名指ししない**。名指しがあるのは §3.8 の*公開 API*文だけである |
| 2 | **1 つの名詞に 1 人の所有者** | §3.7 はライトグリッド（「チャンクデータの一部としてここが所有」）とチャンクフォーマットも本リポジトリに与えている。ブロック書き込みはライトを無効化し、保存対象を汚す。バッファを mc-sim に、そのバッファへの操作をここに置くのは 1 つの名詞に 2 人の所有者であり、`mx-gameplay/stages/registration.ts` のヘッダが記録している失敗（時刻の二重所有。保存されるのは片方だけだった）と同型である |
| 3 | mc-sim の**自前の判断手順** | `mc-sim/docs/responsibility.md` §3.2 の問い 3:「読むためのものか、決めるためのものか → 決めるなら所有者側へ」。チャンクの中身を*決める*のは worldgen（生成・ライト・直列化）で、mc-sim は物理のために*読む*。加えて plan.md §8 は mc-sim の API 肥大を第 2 リスクに挙げている。下流は mc-sim が 6、mc-worldgen が 5 である |
| 4 | **どちら向きにも新しいエッジが不要** | ブロックを読み書きする mc-sim / mc-render / mc-playground-kit / mx-gameplay / mx-redstone は plan.md §2.1 で既に mc-worldgen に依存している |

### 6-1. これは plan.md §3.8 の 1 文と矛盾する（明記しておく）

plan.md §3.8 は「チャンクダーティ通知」を mc-sim の公開 API に挙げ、
`mc-kernel/docs/freeze-checklist.md` の問い 6 もそれを踏襲している。

**この 1 文は §3.7 と両立しない。** mc-worldgen は mc-sim を import できない（循環）ので、
ここが持つフラグを mc-sim が発行するには mc-sim が毎フレーム全ロードチャンクを走査するしかない。
それは `mc-render/docs/public-api.md` §3.3 が名指しで却下している pull 設計であり、
plan.md §3.11 が落下ブロックについて記録している O(chunks×blocks) の惨事と同型である。

したがってチャンネルはフラグと同じ場所、すなわちここに置き、
mc-render は plan.md §2.1 に既にある `render → worldgen` エッジ経由で購読する。
**mc-sim は何も中継しない。**

### 6-2. 逆の選択を採るとどうなるか（人間が覆すための材料）

| | ChunkStore を mc-worldgen（採用） | ChunkStore を mc-sim |
| --- | --- | --- |
| plan.md §3.7 の `ChunkManager` 行 | 埋まる | 永久に空のまま。§3.7 の責務文と矛盾 |
| plan.md §3.8 の「チャンクダーティ通知」 | **mc-sim からは消える**（本節が採る解釈） | 文字どおり満たされる |
| ライトグリッド + チャンクフォーマットとの同居 | 同じリポジトリ | 分離。書き込みのたびに跨ぐ |
| mx-multiplayer のブロック同期 | **`multiplayer → worldgen` エッジの追加が要る**（§2.1 は sim のみ）。追加であって反転ではないので循環はしない | 既存エッジで届く |
| mc-sim の公開 API（plan.md §8 第 2 リスク） | 増えない | 増える |

**唯一の実質的なコストは表の 4 行目である。** mx-multiplayer は現状 §3.14 で
「トランスポートとプロトコルに限定」されており、ブロック同期は未着手なので、
そのエッジが必要になるのは先の話である。それでも、覆すならここが論点になる。

### 6-3. インターフェース

```typescript
export type ChunkSource = (coord: ChunkCoord) => Effect.Effect<Chunk>

export type ChunkStoreApi = {
  // 常駐
  readonly load: (coord: ChunkCoord) => Effect.Effect<Chunk>        // 無ければ ChunkSource で生成
  readonly peek: (coord: ChunkCoord) => Effect.Effect<Chunk | undefined>   // 生成しない
  readonly snapshot: (coord: ChunkCoord) => Effect.Effect<Chunk | undefined> // 切り離したコピー
  readonly isLoaded: (coord: ChunkCoord) => Effect.Effect<boolean>
  readonly loadedCoords: Effect.Effect<ReadonlyArray<ChunkCoord>>
  readonly neighbours: (coord: ChunkCoord) => Effect.Effect<ChunkNeighbours>
  readonly unload: (coord: ChunkCoord) => Effect.Effect<boolean>

  // ブロック
  readonly getBlock: (position: BlockPosition) => Effect.Effect<BlockReading>
  readonly setBlock: (position: BlockPosition, block: BlockId) => Effect.Effect<BlockWriteOutcome>

  // ダーティチャンネル
  readonly subscribeDirty: Effect.Effect<ChunkDirtySubscription>
  readonly subscribeDirtyScoped: Effect.Effect<ChunkDirtySubscription, never, Scope>

  readonly reset: Effect.Effect<void>
}
```

**読み書きはどちらも全域関数でエラーチャネルを持たない。**
`StageRegistration.run` のエラーチャネルが `never` である（kernel の凍結チェックリスト問い 3）以上、
ブロックを書くルールには失敗の置き場が無く、握り潰すしかなくなるからである。

```typescript
type BlockReading =
  | { _tag: 'Block'; block: BlockId }
  | { _tag: 'ChunkNotLoaded' }      // ← air ではない
  | { _tag: 'OutOfWorld' }

type BlockWriteOutcome =
  | { _tag: 'Written'; previous: BlockId; chunk: ChunkCoord }
  | { _tag: 'Unchanged'; previous: BlockId }   // ← ダーティにしない
  | { _tag: 'ChunkNotLoaded' }
  | { _tag: 'OutOfWorld' }
```

- `ChunkNotLoaded` を air と区別するのは必須である。ロード端の砂が「下は air」と教えられると、
  未生成空間に落ちる。mc-meshing は逆に**意図的に混同する**（未ロード隣接は黒い壁ではなく
  空として meshing されるべき）。描画には正しく、シミュレーションには誤りなので、
  2 つの read は別リポジトリの別関数である。
- `Unchanged` がダーティにしないのは、同じブロックの置き直し（流体の水位再表明、
  レッドストーンの同値再計算）が正当な操作だからである。変更扱いにすると永久に毎 tick 再メッシュする。
- `previous` を返すのは、mx-gameplay が「掘ったものをインベントリに入れる」ために
  read-then-write する必要を無くすためである（plan.md §3.8 が警告する TOCTOU）。

### 6-4. ダーティチャンネル: 購読者ごとの集合を drain する

```typescript
type ChunkDirtySubscription = {
  readonly id: SubscriberId
  readonly drain: Effect.Effect<ChunkDirtyBatch>   // 前回の drain 以降に変わったもの
  readonly unsubscribe: Effect.Effect<void>
}

type ChunkDirtyBatch = {
  readonly changed: ReadonlyArray<ChunkCoord>
  readonly removed: ReadonlyArray<ChunkCoord>
}
```

`mc-render/docs/public-api.md` §3.3 が挙げていた「push か pull か」への答え:
**購読者ごとに集合を溜める pull**である。コストは push と同じ O(変更量) で、
かつストアが消費者を知らなくてよい。後者は好みではなく必須である —
mc-worldgen は mc-sim も mc-render も import できない（どちらも循環）ので、
ストアが消費者を*呼ぶ*設計は選択肢に無い。

**集合であってキューでないことが設計の中心である。** 落下する砂の柱は
mx-gameplay の `FALLING_BLOCK_MOVES_PER_TICK = 32` の下で 1 tick に同じチャンクを 32 回汚す。
Stream や `PubSub` なら 32 通、集合なら 1 座標である。重複排除は最適化ではなく、
chunk-sync ステージのコストが O(変更回数) になるか O(変更チャンク数) になるかの分かれ目である。

`removed` を `changed` と分けているのは、mc-render に要求する動作が正反対だからである
（メッシュを作る / `BufferGeometry` を dispose する）。同じ窓の中で変更されてから
アンロードされたチャンクは `removed` にだけ現れ、その逆も同様で、購読者が矛盾を
自分で解決する必要はない。

**新規購読者は空から始まる。** 購読は全再同期の要求ではない。全部返すと
mc-render が世界を 2 回メッシュすることになる。再同期が欲しい呼び出し側には
`loadedCoords` がある。

### 6-5. 意図的に後回しにしたもの

| 未実装 | 理由 |
| --- | --- |
| 永続化（`unload` が保存しない） | mc-save が未消費（plan.md §6 Step 3）。ストレージ読み出しは `ChunkSource` の**前段に合成**され、`ChunkStoreApi` は変わらない |
| `loadChunksAroundPlayer` / LRU 追い出し | 方針（描画距離、退避順）は呼び出し側のもの。`load` / `unload` / `loadedCoords` で外から書ける |
| `Effect.makeSemaphore(4)` による生成の並行度制限 | 参照実装は `chunk-manager-service.ts:45` で掛けている。ワーカープール Port が入るときに一緒に入れる |
| ライトグリッドの再伝播 | ライトグリッド自体が未実装（§8） |
| `dirtyVoxels` 粒度 | チャンク粒度で足りている。位置粒度の追跡は mx-gameplay の `FallingBlockQueue` が既に private に持っており、2 つは合成する |

### 6-6. 参照実装の `ChunkManagerService`

タグは `@minecraft/application/ChunkManagerService`
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

参照実装も**この機能を `packages/world` に置いていた**。`markChunkDirty` と
`drainRenderDirtyChunks` が同じサービスに載っている点に注目してよい。
`ChunkStore` との差は 2 つで、どちらも意図的である:

1. `drainRenderDirtyChunks` は**単一消費者**である。2 人目が drain すると 1 人目の分が消える。
   `ChunkStore` は購読者ごとに集合を持つ（§6-4）。frame には chunk-sync と落下ブロックと
   レッドストーンと自動保存がいるので、単一消費者では足りない。
2. 参照実装は `getChunk` の失敗型に `ChunkManagerError` を持つ。`ChunkStore` の読み書きは
   全域関数である（§6-3）。

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
