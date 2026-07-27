# 設計注意

plan.md §3.7 の 設計注意(参照実装の実測知見) を、
参照実装の実コード (file:line) で裏取りして展開したもの。
plan.md §6 Step 2 の方針に従い、**各項目を「書くべき回帰テストの名前」として提示する**。

`✅` = このスケルトンに実装済み / `⬜` = 未実装（実装時に必ず入れる）

> plan.md §3.7 は「設計注意(参照実装の実測知見)」の項目を回帰テスト化せよと指示している。
> **その指示に従う前に、以下の DN-1 と DN-2 を読むこと。**
> plan.md の記述のうち 1 つは値が誤っており、もう 1 つは前提が古い。
> そのままテスト化すると、誤りが「検証済みの仕様」として固定される。

---

<a id="dn-1"></a>
## DN-1 ✅ ⚠ 地形定数 — **plan.md の値は両方とも誤り**

> plan.md §3.7:
> - 地形定数: `SEA_LEVEL=48`、`LAKE_LEVEL=62`

### 実物

`packages/core/domain/constants.ts`:

```
:16  // Phase 2.1 MC 1.18-aligned. Ocean biome water fills up to this height.
:17  export const SEA_LEVEL = 63
:19  // Phase 2.1 MC 1.18-aligned. Inland lake water surface matches sea level.
:20  export const LAKE_LEVEL = SEA_LEVEL
```

| 定数 | plan.md §3.7 | 実物 | 差 |
| --- | ---: | ---: | --- |
| `SEA_LEVEL` | 48 | **63** | 15 ブロック低い |
| `LAKE_LEVEL` | 62 | **63** | 1 ブロック低い。**かつ独立した定数ではない** |

63 はバニラ Minecraft の海面高度でもある。コメントの "MC 1.18-aligned" と整合する。

### なぜこの誤りが特に危険か

3 つ理由がある。

**1. 誤りが「検証済み仕様」に昇格する。**
この項目は plan.md §3.7 の「回帰テスト化せよ」と指示されたセクションにある。
素直な実装者は `expect(SEA_LEVEL).toBe(48)` を書く。
それが green になった時点で、誤りは検証済みの事実になる。

**2. 存在しない概念（湖面と海面の段差）が生まれる。**
`SEA_LEVEL=48` / `LAKE_LEVEL=62` を採ると、湖面が海面より **14 ブロック高い**。
参照実装に一度も存在しなかった世界になる。
そして「湖と海で水位が違う」を扱う分岐コードが書かれる。
誰も要求していない分岐が、誤った定数を根拠に永続化する。

正しい理解は「**湖面と海面は同一である。両者を区別する定数は存在しない**」。
`LAKE_LEVEL` は `SEA_LEVEL` の別名にすぎない。

**3. 地形の見た目が全く変わる。**
海面が 15 ブロック低いと、同じ高さ場に対して陸地の割合が激増し、
海がほぼ消える。バイオーム分布も変わる。
シードから地形を再現するプロジェクトで、これは根本的な差である。

### mc-worldgen での対応

`domain/constants.ts` に**正しい値と、なぜ plan.md が間違っているかの説明**を書いた。
`LAKE_LEVEL` はリテラル `63` ではなく `SEA_LEVEL` と書いてある。
片方だけ書き換えて乖離することを防ぐためである。

### 書くべき回帰テスト

| テスト名 | 主張 |
| --- | --- |
| ✅ `SEA_LEVEL is 63 — NOT the 48 that plan.md §3.7 states` | `toBe(63)` と `not.toBe(48)` の両方 |
| ✅ `LAKE_LEVEL equals SEA_LEVEL — it is NOT a distinct constant, and NOT 62` | `toBe(SEA_LEVEL)` と `not.toBe(62)` |
| ✅ `DEFAULT_TERRAIN_LEVELS carries both, so generation can be reconfigured without editing code` | 注入可能であること |
| ✅ `never places water above LAKE_LEVEL, anywhere, in any chunk` | 参照実装の `terrain-water-level-invariant.test.ts:28` の移植 |
| ✅ `honours a caller-supplied sea level rather than the baked constant` | 定数が焼き込まれていない |
| ✅ `does put water somewhere, so the sweep above is not vacuously true` | 上の掃引が空虚でない |

実装は `test/terrain-levels.test.ts`。
`not.toBe(48)` / `not.toBe(62)` を明示的に書いてあるのは、
**plan.md を読んだ誰かが「修正」しに来たときに落ちるため**である。

---

<a id="dn-2"></a>
## DN-2 ✅ ⚠ カーバーの水域床ガード — **参照実装では既に修正済み**

> plan.md §3.7:
> - カーバーが川/湖の底をくり抜くと「浮いた水面 + 真っ暗な空洞」になる
>   **(参照実装の重大バグ)**。水域の床マージン検査を最初から入れる

### バグの説明は正確。ただし「重大バグ」という現在形は古い

参照実装は**これを修正済みであり、回帰テストまで付いている**。
つまりこれは「発明を避けるべきバグ」ではなく、**移植すべき修正**である。
しかも修正には非自明な後半があり、それが最も価値の高い部分である。

### 洞窟カーバーの修正

`packages/world/domain/terrain/cave-carver.ts:70-74`:

```typescript
// Keep a solid shell under water bodies: carving the bed away leaves a
// floating water sheet over an unlit cavity (the black-void bug).
if (waterFloorY >= 0 && y >= waterFloorY - CAVE_WATER_FLOOR_MARGIN && y < waterFloorY) {
  continue
}
```

支えているのは柱ごとの最低水位マップ `computeWaterFloorYs`（`cave-carver.ts:18-32`）。
これは意図的に走査範囲を広げている（`:20`）:

```typescript
const scanTop = CAVE_CEILING + CAVE_WATER_FLOOR_MARGIN
```

洞窟の天井のすぐ上にある水床も保護されるようにするためである。

定数は `packages/world/domain/terrain/constants.ts:50`:

```typescript
export const CAVE_WATER_FLOOR_MARGIN = 3
```

`:47-49` のコメントに「洞窟が川/湖の**底**を下から食っていた」と記録されている。

`:67` には「既存の WATER / BEDROCK / AIR は彫らない」という素朴なチェックもあるが、
**それだけが元のバグ版だった**。問題は水そのものではなく、その**床**である。

### 渓谷カーバーの修正 — こちらが本質的に重要

`packages/world/domain/terrain/ravine-carver.ts:41-46`:

```typescript
// Water bodies keep their beds — vanilla surface ravines don't slice rivers open.
if (state.biome === 'OCEAN' || state.biome === 'RIVER') continue
// Same rule for ANY submerged column (lakes, flooded basins): the biome check
// alone let ravines carve lake beds from under their water, leaving a floating
// water sheet over a dark shaft ("hollow lake" black-void bug).
if (blocks[chunkBlockIndexUnchecked(lx, state.surfaceY + 1, lz)] === waterBlockIndex) continue
```

**コメントが修正の歴史をそのまま記録している。**

- 42 行目（biome だけで判定）が**最初の試みで、不十分だった**
- 46 行目（ブロックを直接見る）が**本当の修正**

`PLAINS` の窪地にできた湖は、水没しているが `OCEAN` でも `RIVER` でもない。
biome テストは見逃す。

**両方を移植すること。** biome テストだけを実装すると、
`PLAINS` の湖でバグが再現する。

### 回帰テスト（参照実装側）

- `packages/world/test/cave-carver.test.ts:201` —
  `it('keeps a solid floor shell under water bodies (hollow-lake regression)')`、
  バグの説明が `:202-204` にある
- `packages/world/test/ravine-carver.test.ts:75` —
  `it('keeps lake beds intact: a submerged column on the band is never carved')`、
  経緯が `:76-77`
- `packages/world/test/terrain-water-level-invariant.test.ts:28` —
  `it.effect('never generates water above LAKE_LEVEL')`

### mc-worldgen での対応

`domain/carver.ts` のガードは**ブロックバッファを直接見る**
（`computeWaterFloorYs` は biome マップを一切参照しない）。
つまり `ravine-carver.ts:46` の側から作ってある。

`CarveOptions.waterFloorMargin` を公開してあり、`0` にするとガードが無効になる。
**これはテスト専用の仕掛けである。** バグを再現できない回帰テストは、
今日のコードが今日のコードと等しいことしか主張しない。

### 書くべき回帰テスト

| テスト名 | 主張 |
| --- | --- |
| ✅ `leaves a solid shell of WATER_FLOOR_MARGIN blocks beneath every water body` | ガードが効いている |
| ✅ `the guard is load-bearing: with the margin at 0 the bed really does get eaten` | **バグを実際に再現してみせる** |
| ✅ `protects a submerged column whatever its biome, because it probes blocks not biomes` | biome だけでは不十分だったことを固定 |
| ✅ `finds submerged columns to test against, so the rest is not vacuous` | fixture が空虚でない |
| ✅ `computeWaterFloorYs reports the LOWEST water block, not the surface` | 床であって水面ではない |
| ✅ `computeWaterFloorYs reports -1 for a column with no water` | 水が無い柱 |
| ⬜ `the ravine carver leaves lake beds intact` | 渓谷カーバー実装時 |

実装は `test/carver.test.ts`。fixture は**探索して見つける**方式にしてある
（「洞窟が水域の下を通っているチャンク」を探す）。
地形シェイパーを調整したときにテストが壊れるのではなく、fixture が移動する。

### パスの順序も一緒に移植すること

水を入れてから彫る。ガードは水ブロックを探して働くので、
先に彫るとガードが黙って無効になる。

参照実装の順序:
洞窟は装飾の**前**（`generator.ts:102`）、
渓谷は木・草の**後**（`generator.ts:155`、理由は `:141-142`:
渓谷の壁が鉱石と表層を「きれいに切る」ようにするため）。

---

<a id="dn-3"></a>
## DN-3 ✅ THREE.js を import しない（実測確認済み）

> plan.md §3.7 移植元:
> 参照実装は THREE.js import ゼロを実測確認済み — この分離を維持する

**この記述は正しい。** 裏取り済み:

```console
$ grep -rnE "from ['\"](three|three/)" packages/world --include='*.ts' \
    --exclude-dir=node_modules --exclude-dir=dist
$ echo $?
1     # マッチ無し
```

大文字小文字を無視した `grep -i three` は 17 件ヒットするが、
全て英文の "three"（コメント・テスト名）である。例:
`packages/world/domain/end/end-portal-frame.ts:6`「12 filled frames (three per side)」。

1 件は分離が意図的であることの直接の証拠になっている:

```
packages/world/domain/voxel-raycast.ts:3
// Voxel ray traversal (Amanatides & Woo). Replaces three.js Raycaster for block
```

`packages/world/package.json` の依存も
`@ts-minecraft/{core,block,entity,inventory,worker}` + `effect@^3.20.0` のみで、`three` は無い。

### なぜ重要か

この分離があるから世界生成は Worker でも Node でも canvas 無しのテストでも走る。
参照実装のワーカープールパリティテストが成立しているのもこれのおかげである。

### mc-worldgen での対応

**規律ではなく機構にした。**
`tsconfig.base.json` の `lib` に `"DOM"` を入れていないので、
`new THREE.Vector3()` はこのリポジトリのどこにも書けない（型検査で落ちる）。

依存ホワイトリストも `mc-render` / `mc-meshing` を `not-whitelisted` として落とす。

### 書くべき回帰テスト

| テスト名 | 主張 |
| --- | --- |
| ✅ `rejects mc-meshing: chunk data is produced here, geometry is not our business` | ジオメトリ側への依存を拒否 |
| ✅ `rejects mc-sim, whose reverse edge would be the cycle this gate exists to prevent` | 逆向きエッジ |
| ✅ `finds no path from mc-worldgen to mc-sim, because the edge runs the other way` | グラフ上でも到達しない |
| ⬜ `no source file imports 'three'` | `lib` で防いでいるが、明示的に書いておくと意図が残る |

実装は `test/dependency-policy.test.ts`。

---

<a id="dn-4"></a>
## DN-4 ✅ 木は格子ジッター配置

> plan.md §3.7:
> - 木は格子ジッター配置（トリビアルな乱数散布は視覚的に偏る）

**正しい。ただし参照実装は結果をもっと具体的に書いている。**

`packages/world/domain/terrain/tree-placer.ts:184-188`
（同じ注記が `tree-placer.config.ts:30-34` にもある）:

> `treeDensity` は**柱ごとの実効確率**（バニラの森で約 0.04）だが、
> 配置は柱ごとのベルヌーイ試行ではなく格子ジッターである —
> 「Independent per-column rolls at forest-like rates fused the radius-2 crowns
> into a walkable leaf slab」

つまり「視覚的に偏る」どころではなく、
**森の密度では半径 2 の樹冠が融合して、プレイヤーが歩ける葉の板になる**。
森と床の違いである。

### ⚠ 格子ジッターは最小間隔を保証しない — 参照実装の配置は不十分である

**ここが DN-4 で最も重要な訂正である。** 参照実装の配置をそのまま移植すると、
参照実装自身が警告している「歩ける葉の板」に**再び到達する**。

参照実装の配置（`tree-placer.ts:169-179`）はセル全体にジッターを振る:

```typescript
wx = cellX * TREE_GRID_SIZE + Math.floor(fract(cellRng * TREE_CELL_JITTER_X_SCALE) * TREE_GRID_SIZE)
```

これが抑えるのは**密度**であって最小間隔ではない。
隣接セルの候補は、片方がセルの上端・もう片方が次のセルの下端に落ちれば **1 ブロック**まで
近づく。実測（`TREE_GRID_SIZE = 4`、384×384 の密走査 815 本）:
最近傍間隔 min 1 / p50 3、樹冠が隣と重なる木 75.6%。
ブロックバッファでは 1 チャンク・1 Y の LEAVES 連結成分が **78 ブロック**
（樹冠 1 個は 21）。docs/testing.md §4-b F-2。

### mc-worldgen の配置 — ジッターを窓に閉じ込める

```typescript
const cellRng = Math.sin(cellX * TREE_RNG_X_SCALE + cellZ * TREE_RNG_Z_SCALE) * TREE_RNG_AMPLITUDE
const jitter = (scale) => TREE_CELL_JITTER_ORIGIN + Math.floor(fract(cellRng * scale) * TREE_CELL_JITTER_SPAN)
wx = cellX * TREE_GRID_SIZE + jitter(TREE_CELL_JITTER_X_SCALE)
wz = cellZ * TREE_GRID_SIZE + jitter(TREE_CELL_JITTER_Z_SCALE)
```

セルの縁に候補が入れない溝が残るので、

```
TREE_MIN_SPACING = TREE_GRID_SIZE - TREE_CELL_JITTER_SPAN + 1 = 8 - 3 + 1 = 6
                >= 2 * TREE_CROWN_RADIUS + 2 = 6
```

が**候補格子の上で構成的に**成立する。`>= 2r + 2` であって `2r + 1` ではないのは、
ちょうど `2r + 1` だと両樹冠の端の柱が隣り合って 4-連結してしまうからである。

この下界は**密度ロールより前**に成り立つ。以降のゲートは候補を減らすだけなので、
バイオームにも水没にも依存せずに検査できる。

密度ロール（`tree-placer.ts:215`）— **セルごとに 1 回**:

```typescript
if (fract(candidate.cellRng * TREE_DENSITY_ROLL_RNG_SCALE) >= treeDensity * TREE_GRID_AREA) { ... }
```

定数: `TREE_GRID_SIZE = 8`、`TREE_GRID_AREA = 64`、`TREE_CELL_JITTER_SPAN = 3`、
`TREE_CROWN_RADIUS = 2`（以上は本リポジトリの決定）、
ジッター `3.97` / `5.23`、密度ロール `2.61`、sin-hash `127.1 / 311.7 / 43758.5453`
（以上は `tree-placer.config.ts:26-41` からの移植）。

`density × TREE_GRID_AREA` の変換により、単位**面積**あたりの期待本数が保たれる。
だから格子が 4×4 から 8×8 になっても本数は変わらない。

### 最小間隔 6 は密度の上限でもある

間隔 6 を守る配置は最大でも 1/36 ≒ **0.0278 本/柱**しか置けない。
`BIOME_TREE_DENSITY` の FOREST 0.04 / TAIGA 0.03 は**この上限を超えていた** —
融合しない樹冠では原理的に実現できない密度を要求していたのであり、
葉の板はそれを正直に実現した結果である。0.012 / 0.009 に下げた。
上限内だった SAVANNA 0.008 / PLAINS 0.006 / SNOW 0.004 は据え置きである。

### 書くべき回帰テスト

| テスト名 | 主張 |
| --- | --- |
| ✅ `places at most one candidate per grid cell` | セルあたり 1 本が上限 |
| ✅ `keeps candidates TREE_MIN_SPACING apart, which is what stops crowns merging` | 最小間隔。**下界が tight であること**も主張する |
| ✅ `the candidate always lands inside its own cell, in the jitter window` | ジッターが**窓**を越えない（負のセルでも） |
| ✅ `is deterministic: the same cell always yields the same candidate` | 決定論 |
| ✅ `scales density by the cell area, so the per-column figure keeps its meaning` | 変換式。全バイオームで `< 1` |
| ✅ `asks for no more trees than a non-fusing canopy can hold` | 密度の幾何学的上限 1/36 |
| ✅ `grows denser in forest than in plains, at the same coordinates` | 密度が効いている |
| ✅ `never joins two crowns: the largest leaf patch at one Y is exactly one crown` | **生成ブロックでの測定**（`test/tree-canopy.test.ts`） |
| ✅ `is tight: one block closer and the two crowns become one patch` | 閾値 6 が load-bearing であること |

実装は `test/biome-and-trees.test.ts`（配置）と `test/tree-canopy.test.ts`（ブロック）。

**旧版の教訓**: この表にはかつて
`keeps candidates at least one cell apart, which is what stops crowns merging` という
✅ が並んでいた。その実装は `gap >= 1` を主張していた —
相異なる 2 柱なら常に真であり、**何も主張していない**。
偽のヘッダコメントと空虚なテストが揃うと、偽の主張が検証済みに見える。

### 木の配置はシードに依存しない（参照実装の性質）

`tree-placer.ts:173` の sin-hash はセル座標のみの関数であり、
**シードを含まない**。要塞・寺院の位置決めも同様である。

つまり全シードで木の位置が同じである。
シードで木を変えたいなら、それは**移植ではなく挙動の変更**である。
やるなら意図的にやること。

---

<a id="dn-5"></a>
## DN-5 ✅ 水没した柱には木を植えない

plan.md には無いが、参照実装が 7 行のコメントで記録しているバグである
（`tree-placer.ts:200-206`、ガードは `:207`）。

海面より低い表面は湖底・海底であり、そこに植えた幹は水中を突き抜けて生える。

### 書くべき回帰テスト

| テスト名 | 主張 |
| --- | --- |
| ✅ `never plants on a submerged column, whatever the biome says` | biome が FOREST でも水没なら植えない |

---

<a id="dn-6"></a>
## DN-6 ✅ 決定論 — シード未指定のフォールバックを作らない

`(seed, coords) → Chunk` は全域関数でなければならない。
セーブファイルは地形ではなくシードを保存するので、
生成がぶれると**既存の全ワールドが遡って壊れる**。しかも症状はエラーではなく継ぎ目や穴である。

### 参照実装の罠

`packages/world/domain/perlin.ts:42`:

```typescript
const perm = buildPerm(rand ?? Math.random)
```

**シード未指定時にグローバル乱数へフォールバックする。**
呼び出し側 1 箇所が引数を忘れれば、ロードのたびに違う地形が出る。
型エラーもクラッシュも起きない。

生成経路は偶然これを踏んでおらず、
それを保つための専用テストが存在していた
（`packages/world/test/terrain-determinism.test.ts:10-12`）。
だが「引数 1 個の書き忘れ」で発火する地雷が残り続けていた。

### mc-worldgen での対応

**シードを必須にした。** 消すべきフォールバックが存在しない
（`domain/seeded-random.ts`）。

### チャンネルの非相関化

参照実装はチャンネルごとに Weyl 定数を XOR してシードを分離していた
（`noise-primitives.ts:235-245`）:

```typescript
const raw2D = createPerlinNoise2D(mulberry32(seed))
const raw3D = createPerlinNoise3D(mulberry32((seed ^ WEYL_3D) >>> 0))
const continentalness = signedFbm2D(createPerlinNoise2D(mulberry32((seed ^ WEYL_C) >>> 0)), 4, 0.5, 2.0, 1.4)
...
```

チャンネルを非相関化しないと地形の特徴が揃ってしまう。
温度と湿度が同じ生成器を共有すると、暑い地域は必ず湿っていて、
バイオーム表の半分が到達不能になる。

mc-worldgen は文字列キーで導出する（`channelSeed`）。
チャンネル追加のたびにマジックナンバーを発明して文書化する必要がない。

### 書くべき回帰テスト

| テスト名 | 主張 |
| --- | --- |
| ✅ `produces byte-identical blocks for the same seed and coordinate` | 決定論 |
| ✅ `does not depend on the order chunks are generated in` | 順序非依存 |
| ✅ `gives different seeds different worlds` | シードが効いている |
| ✅ `gives different coordinates different terrain under one seed` | 座標が効いている |
| ✅ `handles negative coordinates, where floor-vs-truncate bugs live` | 負座標。`-1/16` は truncate だと 0 |
| ✅ `agrees about the surface height of a column shared by two chunks` | 継ぎ目が出ない |
| ✅ `surfaceHeightAt agrees with what generateChunk actually built` | 安いクエリと本体が乖離しない |
| ⬜ `worker output is byte-identical to main-thread output` | **参照実装の最重要テストの移植**（`terrain-worker-pool.parity.property.test.ts`, 124 LOC） |
| ⬜ `a fixed seed × coord matrix hashes to the committed golden value` | ゴールデンハッシュ。参照実装には**存在しない** |

実装は `test/determinism.test.ts`。

---

## DN-7 ✅ ライトグリッドはここが所有し、適用は mc-render

> plan.md §3.7:
> - ライトグリッド（BFS 光伝播、4bit パック）はチャンクデータの一部としてここが所有。
>   適用（描画）は mc-render

実装は `domain/light.ts`、キャッシュと無効化は `domain/chunk-store-state.ts`、
公開クエリは `ChunkStoreApi.getLight`。構造とファイルの由来は
[public-api.md](./public-api.md) §8 に整理してある。

`application/chunk-store.ts` のヘッダはブロック書き込みパスをこのリポジトリに置く
根拠の 2 番目として「a block write invalidates light」を挙げていた。それが
主張のままだった期間は終わり、`test/light.test.ts` の
`A BLOCK WRITE INVALIDATES LIGHT` が実際に固定している。

実装時に忘れやすい点（すべて実装に反映済み）:

- **パック処理は `packages/block/domain/light.ts` にある**（`packages/world` ではない）。
  パッケージ境界をまたぐ
- BFS は **remove-then-add の 2 キュー**方式。1 キューでは正しくならない
- `FULL_RECOMPUTE_THRESHOLD = 256` を超えたら全再計算に切り替える
- 参照実装は光を**永続化していない**。ロード時に再計算する
  （`chunk-manager-ops-storage.ts:61`）

### この初回カットが**やっていない**こと

| 項目 | 状態 | 理由 |
| --- | --- | --- |
| インクリメンタル伝播（remove-then-add 2 キュー） | ⬜ | 全チャンク再計算を **遅延**で行う。参照実装自身も `FULL_RECOMPUTE_THRESHOLD = 256` を超えると同じことをするので、欠けているのは小さな編集の高速路であって能力ではない。先に遅い方を出せば、速い方は「一致すべきオラクル」を持って着地する |
| チャンク境界をまたぐ伝播（`MutableBoundaryDirty`） | ⬜ | **保守的な方向ではない**。継ぎ目の向こう側のブロック光が暗く読まれ、松明で照らした部屋の縁に hostile が湧きうる。`domain/light.ts` のヘッダが失敗モードごと記録している |
| 葉・水の減衰 | ⬜ | kernel の `opacity` は 3 クラスを持つが減衰量を持たない。ここで数値を発明すると kernel のテーブルの列を二重所有することになる。kernel が `lightAttenuation` を生やしたら `transmitsLight` がその参照になる |
| 永続化 | ⬜ | 参照実装もしていない（上記）。`defineFormat` を書くときに引き継ぐ判断 |

| テスト名 | 主張 |
| --- | --- |
| ✅ `a light level survives a nibble pack/unpack round trip for every level 0..15` | 4bit パック |
| ✅ `packPosLevel round-trips every coordinate in a chunk` | int32 パック |
| ✅ `removing a light source restores the levels that existed before it` | 2 キュー方式の要点。全再計算がオラクル側を固定する |
| ✅ `does not cross a chunk boundary, which is a KNOWN gap and not an accident` | 上の欠落を、黙って変わらないように固定してある |
| ⬜ `cross-chunk propagation reports the correct boundary flags` | `MutableBoundaryDirty`。境界プロトコルは置き換え予定の実装に対して作らない |

---

## DN-8 ⬜ 地形パイプラインの順序

参照実装の順序は非自明であり、理由がソースに書いてある。

| 段階 | 位置 | 理由 |
| --- | --- | --- |
| 水の充填 | 地形生成時 | カーバーのガードが水を探すため（DN-2） |
| 洞窟 | 装飾の**前**（`generator.ts:102`） | |
| 木・草 | | |
| 渓谷 | 木・草の**後**（`generator.ts:155`） | `:141-142`「壁が鉱石と表層をきれいに切るように」 |
| ライト | 最後（`terrain-generation-utils.ts:49-52`） | 全ブロックが確定してから |

| テスト名 | 主張 |
| --- | --- |
| ⬜ `carving runs after water has been filled, so the water-floor guard has something to find` | 順序を逆にすると DN-2 が黙って無効化される |
| ⬜ `ravines cut through tree trunks, not around them` | 渓谷が木の後である |

---

<a id="dn-9"></a>
## DN-9 ✅ シード固定ゴールデン — ハッシュは**ドリフト検出器であって正しさの証明ではない**

plan.md §3.7 の検証要求と docs/testing.md §3 の完了条件 3。
`test/golden/chunk-goldens.json` に固定シード × 座標行列の SHA-256 を置き、
`test/chunk-golden.test.ts` が `toBe` で比較する。

### なぜスナップショットではないのか

mc-noise は凍結契約を `toMatchInlineSnapshot` で固定している
（`test/public-api.test.ts:60`）。あちらは**人間が読める 9 個のスカラ**なので妥当である。
こちらは 64 文字の 16 進数であり、目視で健全性を判断できない。
そして docs/testing.md §3 は「`pnpm test -u` で黙って通るようにしない」と明示している。
スナップショットは `-u` が無言で書き換える、まさにその成果物である。

したがって更新経路は `pnpm goldens:update` 一本だけであり、
このスクリプトは**何が動いたかを必ず印字する**。黙って上書きするゴールデンは、
ゴールデンを削除するのと同じである（§7 の baseline と同じ理屈）。

### ゴールデンは「今日のバグ」に同意する

これはこの組織で実際に起きた。mc-noise の `buildPermutation` は
API ロックで名前を、ゴールデンで出力を固定していたが、
**どちらもテーブルが全単射でない可能性を見られなかった** —
ゴールデンはテーブルが出すものそのものだからである
（`mc-noise/test/permutation.test.ts:5-26`）。
気づける最初の瞬間はゴールデンを再生成した日で、その時点で再生成が祝福を済ませている。

そこで各ダイジェストには**独立した裏付け**を付ける。
`test/chunk-golden.test.ts` が I-1〜I-8 として列挙し、
**いずれもコミット済み JSON を読まない**。
祝福された再生成はここで落ちる。

| ダイジェスト | 裏付け |
| --- | --- |
| `blocksSha256` | I-1 全バイトが宣言済み `BLOCK` id / I-2 全柱の床が岩盤 / I-3 水面がちょうど `SEA_LEVEL`（DN-1）/ I-4・I-4b 水域下のシェルが中実、かつ**ガードを外すと実際に抜ける**（DN-2）/ I-5 `LEAVES == 木 × 20`（F-2） |
| `biomesSha256` | I-6 `biomeFor` を柱ごとに再計算した配列と一致 / I-7 閉じたロスターの要素のみ |
| 両方 | I-8 再生成がバイト一致 |

I-6 が要である。`generateChunk` は自分の柱ループの中で `chunk.biomes` を埋めるので、
**別経路で組み直した配列と一致すること**が証拠になる。
256 個の `'PLAINS'` で埋めたプレースホルダでも、ハッシュは完璧に安定する。

### 座標行列は規則で選ぶ

`BIOMES` の各要素について、**256 柱すべてがその バイオームに分類される、原点に最も近いチャンク**
（チェビシェフ環で探索、つまり答えはシードの関数でありスキャン順に依らない）。

規則のほうが座標より重要である。原点付近の 3×3 を手で選ぶのは F-5 の裏返しであり、
DESERT の最寄りは (33, 48)、SNOW は (22, -60) — **原点近傍の行列には物理的に入らない**。
その 2 つを落とした行列は、両者が生成されなくなった日に何も言えない。

9 行目は FOREST を `decorate: false` で再生成する。
これが無いと全ダイジェストが装飾パスを通っており、
木の配置器を丸ごと削っても「他のどんな変更とも同じように」不一致になるだけで、差分が局在しない。

### 10 行目は**空虚な合格**の結果として足した

最初の 9 行では I-4（水域下のシェルが中実）が**空虚に成立していた**。
`carveCaves` からガードを削って（`waterFloorMargin ?? 0`）実行しても 15 件すべて green になる。
理由は docs/testing.md §4-b **F-4 に既に書いてある**:
このシードの原点付近では洞窟が湖底の 3 ブロック以内に来ないので、
ガードには仕事が無く、その不在にも壊すものが無い。

(4, 9) は原点から 40 チャンク以内で最も強い反例で、
マージン 0 にすると 256 柱中 **229 柱**が水底シェルを失い、ガード有りでは **0** である。
I-4b がこの両側を主張する。`test/carver.test.ts` の規則
——**バグを再現せよ、不在を主張するな**——のゴールデン版である。

| テスト名 | 主張 |
| --- | --- |
| ✅ `reproduce their digests exactly, chunk for chunk` | 生成地形のバージョン間ドリフト |
| ✅ `covers every biome, including the two a narrow window says do not exist` | 行列が DESERT / SNOW を含む |
| ✅ `isolates the decoration pass: the two FOREST rows differ only in vegetation` | 装飾が基礎パスに漏れていない |
| ✅ `I-4b: and the guard is what does it` | ガードを外すと実際に 200 柱以上が抜ける |

---

<a id="dn-10"></a>
## DN-10 ✅ バイオーム分布の統計テスト — 走査窓は**一番遅い場に対して**測る

docs/testing.md §3 の完了条件 7、§4-b F-5。
`test/biome-distribution.test.ts`。雛形は `test/terrain-distribution.test.ts`。

### F-1 と F-5 は同じ形の欠陥である

F-1: `CONTINENTALNESS_CONTRAST` を 800 ブロック窓で正当化 → 世界の 2 割が平ら。
F-5: バイオーム分布を 384 ブロック窓で測定 → 「DESERT と SNOW は到達不能」という誤結論。
**同じ誤りが 2 回起きており、2 回目は 1 回目と同じ形だと気づかれずに報告された。**

### 180 を流用してはならない

`test/terrain-distribution.test.ts` は「連続性の特徴 40 個以上」を主張する。1/180 だからである。
バイオーム選択が読む場は 3 つあり、周波数が違う:

| 場 | 波長 | どこ |
| --- | ---: | --- |
| temperature | 320 | `climateAt` |
| humidity | 280 | `climateAt` |
| continentalness | 180 | `surfaceHeightAt` → `biomeFor` の OCEAN/BEACH 上書き |

**拘束するのは一番長い 320** である。320 の裾が入る窓は他の 2 つには自動的に十分だからである。
180 基準の「40 特徴」は span 7200 を許すが、7200 は temperature では **22.5 特徴**しかない。
定数を別の母集団の測定から流用する——それが F-1 の誤りそのものである。

### 25 という数字の根拠（実測）

同じ 5 シードで span を振ると、狭くなって劣化するのは希少バイオームの**存在**ではなく
**割合の安定性**である。最も希少な DESERT のシード間ばらつき:

| span | temperature 特徴数 | DESERT（5 シード） | ばらつき |
| ---: | ---: | --- | ---: |
| 4096 | 12.8 | 0.017% .. 0.336% | 20x |
| 5760 | 18.0 | 0.045% .. 0.239% | 5x |
| 7200 | 22.5 | 0.099% .. 0.351% | 3.5x |
| **8192** | **25.6** | **0.086% .. 0.295%** | **3.4x** ← 採用 |
| 16384 | 51.2 | 0.191% .. 0.252% | 1.3x |

**どの span でも 8 バイオーム全部が全シードで出る。** F-5 が報告した「消失」は
もっと狭い窓（384）でないと起きない。

だから 25 は丸い数字ではなく、**下のバンドが実際に妥当である幅**として選んである:
span 4096 では DESERT の最小値 0.017% が本ファイルの DESERT バンドを**下回って落ちる**。
窓を狭めることは精度が落ちることではなく、
**コミット済みの閾値がもう記述していない対象を測ること**である。

### バンドであって割合ではない

実測（5 シード、SURVEY 幾何）:

| バイオーム | 実測 | バンド |
| --- | --- | --- |
| OCEAN | 33.4 .. 35.1% | 0.20 .. 0.50 |
| BEACH | 15.0 .. 16.3% | 0.07 .. 0.28 |
| DESERT | 0.1 .. 0.3% | 0.0002 .. 0.03 |
| SAVANNA | 3.0 .. 4.6% | 0.01 .. 0.12 |
| PLAINS | 20.3 .. 22.5% | 0.10 .. 0.35 |
| FOREST | 15.2 .. 16.9% | 0.07 .. 0.30 |
| TAIGA | 7.5 .. 8.7% | 0.03 .. 0.18 |
| SNOW | 0.6 .. 0.9% | 0.001 .. 0.05 |

理由は `test/terrain-distribution.test.ts` が自分の 1% 閾値について述べているのと同じである:
**ゲートすべきは欠陥であって今日のノイズではない**。
OCEAN を 0.351 で固定すればシード変更・ストライド変更・意図的な調整すべてで落ち、
やがて緩められ、緩められるテストは読まれなくなる。

捕まえるのは 2 つ: バイオームが 0 に落ちること（F-5）と、
1 つが地図を占領すること（`PLAINS` が**フォールバック**なので、
ルール表が一致しなくなっても例外は飛ばず、草の惑星が出来る）。

### 構造的な半分——バンドと独立で、厳密

`biomeFor` の高度上書きは `classifyBiome` の**上流**にあり、閾値が `seaLevel` を挟むので、
**全柱・全シードで、測定抜きに**次の 2 つの包含が成り立つ:

```
OCEAN          ⊆  海面下
海面下          ⊆  OCEAN ∪ BEACH
```

バンドは通るまで広げられるが、包含は広げられない。
これが `test/terrain-distribution.test.ts` が固定する高度分布と本ファイルを結び付けている。

BEACH が `[seaLevel-2, seaLevel+1]` の**固定幅 4 ブロックの高度帯**であることも主張する。
F-1 で地形を平らでなくしたとき BEACH が 7.1% → 15.9% に増えた
（バイオーム分類は触っていない）その機構であり、
次に BEACH が動いたとき見るべきなのは `BIOME_RULES` ではなくシェイパーだと言うためである。

| テスト名 | 主張 |
| --- | --- |
| ✅ `is wide enough for the SLOWEST climate field, not merely for continentalness` | 320 基準で 25 特徴以上 |
| ✅ `and a narrow window is not: 384 blocks reports biomes that do not exist as missing` | F-5 の再現 |
| ✅ `reaches all 8, including DESERT and SNOW` | ロスターに嘘が無い |
| ✅ `puts every biome inside its measured band` | 消失・占領の両方 |
| ✅ `no column below sea level classifies as a land biome` | 包含（厳密） |
| ✅ `BEACH is a height band, so it tracks the shaper and not the climate` | F-1 の副作用の機構 |

---

<a id="dn-11"></a>
## DN-11 ⬜ `BIOME_SURFACES.underwaterTop` の `GRAVEL` は**到達不能**である

ゴールデンのブロックヒストグラムを読んで見つかった。
10 チャンク全部で `GRAVEL` が **0** である。偶然ではなく、構造的に 0 である。

`domain/biome.ts` は 5 つの バイオームに `underwaterTop: BLOCK.GRAVEL` を与えている
（SAVANNA / PLAINS / FOREST / TAIGA / SNOW）。
`fillColumn` がこれを読むのは `submerged`、つまり `surfaceY < levels.seaLevel` のときだけである。
ところが `biomeFor` は同じ柱について:

```
surfaceY <  seaLevel - 2   -> OCEAN
surfaceY <= seaLevel + 1   -> BEACH
```

を**先に**返す。`surfaceY < seaLevel` を満たす柱は必ずこのどちらかに落ちるので、
`underwaterTop` が実際に読まれるのは OCEAN と BEACH の行だけであり、
その 2 つは両方 `SAND` である。
`seaLevel` は注入されるので、この論証は既定値だけでなく**あらゆる `TerrainLevels`** で成り立つ。

つまり `GRAVEL` は現時点で**生成されないブロック id** である。
`test/kernel-mirror.test.ts` は mc-kernel との id 一致を固定しているので綴りは正しいが、
一致していることと生成されることは別である。

**直していない。** どちらの修正も設計判断だからである:

- 5 行の `GRAVEL` を消す → 「水没した草地は砂利になる」という意図の記録を失う
- `biomeFor` の上書きを緩めて内陸湖を気候バイオームのままにする → DN-2 のガードが
  依存している「水没柱 = OCEAN/BEACH」という前提と、F-1 で測った BEACH 15.9% が動く

どちらも本タスクの範囲外である。ここに記録して、
`ChunkManager` と河川・湖が入るとき（`underwaterTop` が初めて意味を持つとき）に決める。

| テスト名 | 主張 |
| --- | --- |
| ⬜ `an inland lake keeps its climate biome, so underwaterTop is reachable` | 上を解消したときに入れる |
