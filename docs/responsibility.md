# 責務

出典: plan.md §3.7。参照実装の実コードで補正した箇所には根拠を付けてある。

## 1. 責務（plan.md §3.7 原文）

> バイオーム分類・地形生成・カーバー（洞窟/渓谷）・植生・**構造物（砂漠のピラミッド/村/ポータル/End）**・
> チャンクのライフサイクル管理。永続化は mc-save のツールキットでチャンクフォーマットを定義

### 具体的に持つもの

| 要素 | 説明 | 状態 |
| --- | --- | --- |
| 地形定数 | `SEA_LEVEL` / `LAKE_LEVEL` を `TerrainLevels` として注入 | ✅ |
| 決定論シード | `(seed, coords) → Chunk` の全域性 | ✅ |
| バイオーム分類 | 気候 → バイオーム（ルールテーブル、first-match-wins） | ✅ 地形経路は 6 入力版（2 入力補助 API も保持） |
| 地形生成 | 高さ場 → ブロック充填 → 水位 | ✅ |
| 地形生成（Nether） | `nether-terrain.ts` が決定論的な 3D 密度場、上下の岩盤、溶岩海、ソウルサンドと構造物用の実地形 sampler を提供する | ✅ |
| カーバー（洞窟） | **水域の床マージン検査つき**。`domain/carver.ts` の `carveCaves` | ✅ |
| カーバー（渓谷） | ノイズ帯 + テーパー壁 + **2 層の水ガード**。`domain/ravine.ts` の `carveRavines`。装飾の**後**に走る（下記 §1-6） | ✅ 深部の溶岩床を含む |
| 植生（木） | 格子ジッター配置 | ✅ 配置ロジック |
| 植生（草・花） | タンポポ / ポピー / 背の高い草 / シダに加え、サボテン / サトウキビ / キノコ / 水生植物 / スイレン。`domain/vegetation.ts` | ✅ 条件つき特殊植生を含む（参照実装との全密度一致は未検証） |
| 鉱石 | 7 鉱石の脈生成。`domain/ore.ts`。**深度帯は再導出した**（下記 §1-2） | ✅ 石 / 深層岩の 14 variant |
| 構造物（stronghold） | サイト決定 `domain/structure-siting.ts` と 13×13 石室生成 `domain/stronghold.ts`。各チャンクが自分の断面を書き、境界をまたぐ | ✅ |
| 構造物（Nether fortress） | `domain/nether-fortress.ts` が seed / region 候補、地形適合、Nether brick の断面、loot / mob / spawner marker を計画し、`domain/nether-terrain.ts` がチャンクへ適用する | ✅ plan + generator 適用 |
| 構造物（bastion remnant） | `domain/bastion-remnant.ts` が Nether の平坦な shelf を検査し、mc-kernel 登録ブロックだけで compact structure、loot / piglin / piglin-brute marker を計画し、`domain/nether-terrain.ts` がチャンクへ適用する | ✅ plan + generator 適用 |
| 構造物（ポータル） | 検出・点火用 `portal-frame.ts` に加え、`natural-structure.ts` が ruined portal の immutable plan と marker を提供し、`nether-terrain.ts` が境界をまたぐ plan をチャンクへ適用する | ✅ plan + generator 適用 |
| 次元リンク（ネザー） | 8:1 の座標スケーリング・最近傍ポータル探索・移動先の解決。`domain/nether-link.ts` と `domain/nether-travel.ts`。**§6 の「残りの半分」表の 3 行を消費した**。両方を `index.ts` から公開する（下記 §6-1） | ✅ barrel 公開 |
| 構造物（村） | 参照実装に存在しないため新規設計。既存 Overworld 生成と同じ配置を `natural-structure.ts` が immutable plan と semantic marker で公開する | ✅ |
| 構造物（desert pyramid） | `domain/desert-pyramid.ts` が乾燥した砂漠サイトを選び、砂岩ピラミッド、地下 chamber、TNT、chest と loot marker を計画し、`natural-structure.ts` が Overworld chunk へ適用する | ✅ plan + generator 適用 |
| 構造物（igloo） | `domain/igloo.ts` が雪バイオームの平坦なサイトを選び、雪ドーム、地下室、設備、chest と villager / zombie-villager marker を計画し、`natural-structure.ts` が Overworld chunk へ適用する | ✅ plan + generator 適用 |
| 構造物（jungle pyramid） | `domain/jungle-pyramid.ts` がジャングル地形の平坦なサイトを選び、mc-kernel 登録ブロックだけで構成した compact structure、TNT、chest と loot marker を計画し、`natural-structure.ts` が Overworld chunk へ適用する | ✅ plan + generator 適用 |
| 構造物（ocean ruin） | `domain/ocean-ruin.ts` が海洋バイオームの浅すぎない海底を選び、登録済み石系ブロックの遺跡、chest と loot marker を計画し、`natural-structure.ts` が Overworld chunk へ適用する | ✅ plan + generator 適用 |
| 構造物（ocean monument） | `domain/ocean-monument.ts` が海洋バイオーム・水深・海底の平坦さを検査し、mc-kernel 登録ブロックだけで compact monument、chest と loot marker を計画し、`natural-structure.ts` が Overworld chunk へ適用する | ✅ plan + generator 適用 |
| 構造物（mineshaft） | `domain/mineshaft.ts` が地下通路、木製支柱、レール、装飾、chest と loot marker を登録済みブロックだけで計画し、`natural-structure.ts` が Overworld chunk へ適用する | ✅ plan + generator 適用 |
| 構造物（pillager outpost） | `domain/pillager-outpost.ts` が登録済みブロックだけで compact tower を計画し、乾燥地形適合、chest + loot marker、pillager marker を提供し、`natural-structure.ts` が Overworld chunk へ適用する | ✅ plan + generator 適用 |
| 構造物（shipwreck） | `domain/shipwreck.ts` が海洋バイオームの十分な水深と平坦な海底を選び、登録済み木材の船体、chest と loot marker を計画し、`natural-structure.ts` が Overworld chunk へ適用する | ✅ plan + generator 適用 |
| 構造物（End） | 外縁島へ End city / ship を配置する immutable plan と marker を `natural-structure.ts` が提供し、`end-terrain.ts` が境界をまたぐ plan をチャンクへ適用する。`end-features.ts` がスパイク、柱、クリスタル／ケージ marker を同じモデルで提供し、`end-gateway.ts` が bedrock shell と出口設定の純粋 API を提供する。`domain/end-portal.ts` は完成ポータル判定と到着地点を提供する | ✅ city / ship / spike / portal rule |
| ライトグリッド | BFS 光伝播、4bit パック、空/ブロックの 2 グリッド。公開 façade は `src/domain/light.ts`、実装は `light-grid.ts`・`light-propagation.ts`・`light-update.ts`。`ChunkStore.setBlock` が無効化する | ✅ 全チャンク再計算版 |
| `ChunkStore`（= plan.md §3.7 の `ChunkManager`） | ロード / アンロード / **ブロック書き込み** / ダーティチャンネル。`application/chunk-store.ts` | ✅ インメモリ + `PersistentChunkStoreLayer` |
| ワーカープール Port | `TerrainWorkerPoolPort` と `chunkSourceFromTerrainWorkerPool` を公開。Worker/Pool の媒体はホストが注入し、mc-worldgen は DOM/Worker を所有しない | ✅ 型 + adapter |
| チャンクフォーマット定義 | `domain/chunk-format.ts`。`mc-save` の `defineFormat` と `PersistentChunkStoreLayer` で利用 | ✅ フォーマット定義 + `StoragePort` 接続（媒体はホスト注入） |
| 地形プレビュー | **本計画の最初の遊べる成果物**。`apps/preview-terrain/`（dev アプリ、公開 API ではない） | ✅ |

### 1-1. この表は 6 回間違えた。今回の訂正の内訳

上の表は **⬜ が 7 行あった**。実測した結果、その 7 行は 3 種類に分かれた。

| 元の行 | 判定 | 根拠 |
| --- | --- | --- |
| ライトグリッド | **STALE（実装済みだった）** | `src/domain/light.ts` と分割実装は BFS 伝播・4bit パック・2 グリッドを実装し、`test/light.test.ts` が固定している。⬜ のまま放置されていた |
| ワーカープール Port | **半分 STALE** | 継ぎ目 `ChunkSource` は実装済みで `test/chunk-store.test.ts` が使っている。名前つき Port 型だけが無い |
| カーバー（渓谷） | **REAL** → 今回実装 | `carver.ts` は `carveCaves` だけだった。`domain/ravine.ts` として移植（§1-6） |
| 植生（草・花） | **REAL** → 今回実装 | `tree-placement.ts` は木であって地被ではなかった |
| 鉱石 | **REAL** → 今回実装 | 初回監査時は語彙だけだったが、現在は `domain/ore.ts` が脈配置と石 / 深層岩 14 variant を実装している |
| 構造物（desert pyramid / igloo / jungle pyramid / mineshaft / ocean ruin / ocean monument / pillager outpost / shipwreck / 村 / End / Nether fortress / bastion remnant） | **REAL**、ただし desert pyramid、igloo、jungle pyramid、mineshaft、ocean ruin、ocean monument、pillager outpost、shipwreck、村、bastion remnant は新規設計 | stronghold、desert pyramid、igloo、jungle pyramid、mineshaft、ocean ruin、ocean monument、pillager outpost、shipwreck、Nether fortress、bastion remnant、End city / ship は各 planner とチャンク投影を実装。村は §1-3 |
| チャンクフォーマット定義 | ~~**REAL、かつブロック中**~~ → **判定そのものが誤り**。7 回目の訂正 | §1-5 |

**⬜ が「まだ誰も手をつけていない」を意味しない行が 2 つあった。**
状態表が信用されなくなったのは、この 2 行と初回監査時の未実装項目を
同じ一覧で区別できていなかったためである。現行の残課題は下記の差分表に記録する。

### 1-2. 鉱石: 参照実装の深度帯は 3 行をローカル地形へ再導出した

`ORE_CONFIGS`（`terrain/constants.ts:72-78`）は参照実装の地形に合わせてある。
本リポジトリの石は **構造的に y ≤ 87 にしか存在しない**
（`MAX_SURFACE_Y - FILLER_DEPTH - 1 = 92 - 4 - 1`）。
COAL と EMERALD の `peakY = 96` はこの天井の**上**にある。

以下の表は深層岩層を追加する前の初回監査時の石だけの比較であり、参照帯をそのまま移植した場合の欠損を示す。現行の `domain/ore.ts` はこの結果を受けて石の上限を再導出し、深層岩層には同じ 7 種の variant を対応づけている。

実測（144 チャンク × 3 シード、両方の帯を同じ石に対して実行）:

| 鉱石 | 意図した量 | 本リポジトリの帯 | 参照実装の帯 |
| --- | ---: | --- | --- |
| COAL | 180 | 97 / 99 / 99 % | 68 / 80 / 82 % |
| EMERALD | 4 | 94 / 100 / 102 % | 57 / 74 / 74 % |
| 他 5 種 | — | 95-104 % | 95-104 %（**動かない**） |

**そのまま転記していれば石炭が 2-3 割、エメラルドが 3-4 割静かに消えていた。**
`CONTINENTALNESS_CONTRAST` と同じ形の誤り —
数値は実在し、出典もあり、別の地形を記述している。
`test/ore.test.ts` O-5 が**この欠陥を再現する**ので、帯を戻せば赤くなる。

### 1-3. 村は「未移植」ではなく「出典が無い」

`docs/porting.md` §6 が参照由来の構造物として挙げる行に村は無い。
それは列挙漏れではない。実測: `packages/world` 全体で「village」は 4 箇所、
**全て作物の成長に関するコメント**（`crop-growth.ts:2`、
`crop-growth-service.ts:20`、`block-service.config.ts:175`）と、
`world-metadata-model.ts:59,68` の Mob 名 `Villager` / `ZombieVillager` である。

**参照実装に村の生成器は無い。**
したがって村は「移植すればよい行」ではなく、家のスキーマ・道路グラフ・
村人スポーン・バイオーム別パレットを**新規に設計する行**である。
他の全ての行が転記であるのに対し、これだけ種類とリスクが違う。
⬜ のままだと「誰かがまだ手をつけていないだけ」に読めるので、
状態を **⬜ 出典なし** に変えた。

### 1-4. ワーカープール Port: 型と継ぎ目を分離する

`ChunkSource = (coord: ChunkCoord) => Effect.Effect<Chunk>` が注入点で、
`ChunkStoreLayer(source)` がそれを受け取る。plan.md §3.7 の
「実装は利用側が注入」は**すでに満たされている**。

`TerrainWorkerPoolPort` は `generateTerrain(coord)` だけを要求し、
`chunkSourceFromTerrainWorkerPool` が既存の `ChunkSource` に変換する。
DOM の `Worker` 型、キュー、キャンセル、通信エラーはこの Port に持ち込まない。
それらはホストまたは `mc-render` の汎用 Worker Pool が所有する責務であり、
ここで重複すると実行媒体と地形生成の責務が結合する。

Port の生成契約は既存 `ChunkSource` と同じ `Effect<Chunk>` に固定している。
これにより `ChunkStoreLayer` のロード・永続化エラー契約を壊さず、同期 generator と
Worker adapter を同じ注入点で交換できる。通信エラーを型付きで扱う必要が生じた場合は、
Worker transport の `Result` を定義した上で、別の application boundary として追加する。

### 1-5. チャンクフォーマット定義は**ブロックされていなかった**

この節は以前こう書いていた:

> mc-save の `defineFormat` は**実在する**（`@nerima-games/mc-save`）。
> 現在は `package.json#dependencies` に公開版を直接宣言して import している。
>
> つまりこの行は「やっていない」ではなく「**やれない**」。

**この段落は、事実は全て正しく、結論だけが逆である。**
そして自分の結論を否定する材料を自分で挙げている。

「理由は `mc-kernel` と同じ」——`mc-kernel` は
**publish を待った file ではない。待つ必要を無くした file である。**
本リポジトリはそれを `domain/biome.ts` と各ドメインテストで固定し、
その上に `light.ts` も `terrain.ts` も載せている。
同じ手は組織全体で 13 回使われている:

| ミラー | 何を代理しているか | 持っているリポジトリ |
| --- | --- | --- |
| `mc-kernel` | mc-kernel | mc-sim / mc-render / mc-playground-kit / mc-compose / **mc-worldgen** |
| `domain/frame-contract.ts` | mc-kernel | mx-gameplay / mx-redstone / mx-ui |
| `domain/block-vocabulary.ts` | mc-kernel | mx-gameplay |
| `domain/chunk-store-port.ts` | **mc-worldgen** | mx-gameplay |
| `domain/entity-manager-port.ts` | mc-sim | mx-gameplay |
| `domain/inventory-port.ts` | mc-sim | mx-gameplay |
| `domain/portal-frame-port.ts` | **mc-worldgen** | mx-gameplay |

**mc-worldgen は既に 2 回ミラーされる側になっている。**
自分が publish されていないことを理由に他リポジトリが止まってはいない。
止まっていたのはこちらだけで、その理由は publish ではなく
**誰もミラーを書いていなかったこと**である。

依存グラフ上の障害は無い。⬜ の noun は「publish 待ち」ではなく
「**未着手**」だった。現在の直接依存と生成・保存の境界は
`docs/versioning.md` と `package.json` に記録している。

### 1-5-b. 今あるもの

| file | 何 |
| --- | --- |
| `mc-save` | mc-save の format 語彙のミラー。9 value + 3 type。`defineFormat` / `encodeSave` / `decodeSave` / `SaveFormat` / `Migration` / エンベロープ / 2 つのエラー型 |
| `domain/chunk-format.ts` | `CHUNK_FORMAT`。`Chunk` ⇄ 符号化形の v1 フォーマット |
| `test/chunk-format.test.ts` | CF-1 〜 CF-16 |
| `test/save-format-mirror.test.ts` | SF-1 〜 SF-17。ミラーの転記を両方向で固定 |
| mc-dev-meta `MIRROR_SPECS` | 12 行目。**mc-save を source とする最初の行**。外側からの比較 |

どちらも `index.ts` には出していない。理由は mx-gameplay の 4 つのミラーと同じで、
他リポジトリのサービスを本パッケージの公開面に載せると
スタンドインの削除が consumer にとって破壊的変更になるからである。
副作用として `api-lock.md` は 156 entries のまま動いていない
（plan.md §6 Step 3 の 4 週間時計に触れていない）。

**残っているのは媒体だけ**である。`StoragePort` / `saveTo` / `loadFrom` は
意図的にミラーしていない（`mc-save` のヘッダに列挙してある）。
`ChunkStore.unload` が保存を始める日に要るもので、それは §5 の最終行である。

### 1-6. 渓谷カーバー: 定数は 1 つだけ検算が要った

`domain/ravine.ts`。移植元は `packages/world/domain/terrain/ravine-carver.ts`（68 行）。

洞窟とは**機構が違う**ので `carver.ts` を拡張していない。
洞窟は 3D 密度場の閾値、渓谷は**ノイズ帯** —
低周波 2D 場の 1 つの値の周りの薄い区間である。
連続場の等位集合は曲線なので、これが「峡谷」になる。

**転記しただけの定数と、検算した定数を区別してある。**

| 定数 | 出典 | 扱い |
| --- | --- | --- |
| `RAVINE_NOISE_SCALE` 0.004 | `ravine-carver.ts:10` | 転記。波長 250 ブロックは両者で同じ意味 |
| `RAVINE_CENTER` 0.5 | `:12` | 転記 |
| `RAVINE_HALF_WIDTH` 0.006 | `:15` | **転記 + 実測**。下記 |
| `RAVINE_MAX_DEPTH` 28 | `:16` | 転記（美的判断としては未検証） |
| `RAVINE_MIN_DEPTH` 3 | `:51` の literal | 転記。命名しただけ |
| `RAVINE_FLOOR_Y` 6 | `:53` の literal | 転記 |
| ~~`RAVINE_WORLD_OFFSET` 40_000~~ | `:11` | **落とした**。`channelSeed(seed, 'ravines')` が同じ仕事をする。`vegetation.ts` が salt を落としたのと同じ論拠 |
| `RAVINE_LAVA_BED_BELOW_Y` 16 | `:17` | **実装済み**。通常の Overworld 地形では到達不能だが、低い合成地形の境界テストで固定 |

**帯の幅だけは検算が要った。** 参照実装のコメント自身が
「単一オクターブのノイズは 0.5 付近に集まるので、この狭い帯でも ~2% の柱を拾う」
と書いている。つまり 0.006 は**あちらの分布に対して校正された数字**であって、
現在の `mc-noise` の平滑化 value noise には無条件では移らない。

参照実装はこの誤りを一度踏んでいて、証拠を残している —
`biome-classifier.config.ts:32-33`:「旧 0.055 の帯は世界の ~16% を RIVER に分類した（vanilla は 3-6%）」。
`CONTINENTALNESS_CONTRAST` と同じ形である。

SURVEY 走査（8192×8192 を 16 ブロックおき、262,144 柱、5 シード）の結果:

| 半幅 | 帯に入る柱 |
| --- | --- |
| **0.006** | **1.7 - 2.0%** ← 採用 |
| 0.010 | 2.8 - 3.3% |
| 0.020 | 5.6 - 6.5% |

参照実装の意図 ~2% に合う。**転記できたのであって、帯幅が可搬なのではない。**
`pnpm preview --stats` がこの割合を毎回印字する。

**溶岩床が到達不能な理由**は算術である。水ガードが `surfaceY + 1` に水がある柱を全て拒否し、
`terrain.ts` は `surfaceY + 1` から `seaLevel` まで水を入れる。
よって彫られる柱は `surfaceY >= 63`、`floorY >= 63 - 28 = 35` であり、
`floorY <= 16` は決して成立しない。`pnpm preview --stats` の実測でも最深床は 35 である。
入力の無いコードパスのために LAVA id と `BLOCK_NAMES` の行を増やすのは、
`ore.ts` が記録した COAL `peakY = 96`（天井の上にある帯）と同じ誤りになる。

**装飾の後に走る**（`generator.ts:141-142`「壁が鉱石と表層をきれいに切るように」）。
その代償として、彫られた柱の上に立っていたものが宙に残る。
草花は消している（`clearGroundCover`、band 柱の 7.7% で発生）。
**木は消していない** — 5×5 の樹冠の所有者を `plantTree` が記録していないので、
除去には機構が要る。実測 2.4%（最悪の窓で LOG 580 セル中 14）。
`test/ravine.test.ts` R-8 が固定している。

### 1-7. ポータル: 「通常の枠を生成する器はまだ無い」という記述を分解する（8 回目の訂正）

この表は 6 回間違えたと §1-1 が書き、`chunk-format` で 7 回目になった。**これが 8 回目**である。

行は「**枠の検出だけ**。生成器はまだ無い」と書いていたが、ここでいう生成器を
「ポータルのセル配置を組み立てる機能」と読むなら、
`domain/portal-frame.ts:296` に `generatePortalLayout` があり、
`PortalLayout` 型があり、`test/portal-frame.test.ts` の 19 件がそれを使っている
（検出との往復スイープ 760 フレームは、この関数が無ければ書けない）。

一方、通常のポータル枠を地形へ配置する生成器は現在もない。`generatePortalLayout` は
検出の逆変換とプレビュー用オーバーレイのセル配置を返すものであり、通常枠を
`Chunk` に書き込む地形生成処理ではない。荒廃したポータルの生成は別の自然構造として扱う。

**しかも同じ文書の §6 が既にそう書いていた** —
「`generatePortalLayout`（枠の**生成**）のほうは §3.7 が直接の根拠になる」。
表と本文が矛盾したまま置かれていた。`carver.ts` が既に彫っていた洞窟を ⬜ と書いていたのと同じ形である。

🟡 のままなのは理由が変わったからで、程度が変わったからではない:
**`generateChunk` がこれを呼んでいない。** 生成器はあるが呼び出し元が無いので、
世界に自然生成される黒曜石の枠は今も 0 個である。
それが埋まるのは要塞・村と同じ「構造物のブロック生成」の行（§5）であって、この関数の行ではない。

## 2. 非スコープ（ここに書いたら負け）

| 非スコープ | 正しい置き場 | 理由 |
| --- | --- | --- |
| ジオメトリ生成（メッシング） | **mc-meshing** | チャンクデータを作るのはここ、面を作るのは meshing |
| ライトの**適用**（描画） | **mc-render** | plan.md §7:「ライティング → worldgen（データ）+ render（適用）」 |
| ノイズ関数そのもの | **mc-noise** | worldgen は `mc-noise` の公開 sampler を直接利用し、独自の互換境界を持たない |
| 永続化の機構 | **mc-save** | worldgen は `defineFormat` でフォーマットを定義し、`StoragePort` 接続を提供する。媒体はホストが注入 |
| プレイヤー・エンティティの状態 | **mc-sim** | sim が worldgen に依存する。逆向きは循環 |
| 「木を斧で切ると原木が落ちる」 | **mx-gameplay** | 動詞は体験モジュール（plan.md §2.3-1） |
| 「落下ブロック（砂/砂利）」の挙動 | **mx-gameplay** | 同上。plan.md §3.11 |
| 流体の伝播 | **mx-gameplay** | 同上。生成時の水位設定とは別物 |
| 「ブロックを壊したら / 置いたら何が起きるか」 | **mx-gameplay** | 同上。**ただし書き込みを受け付ける器（`ChunkStore.setBlock`）はここ** — 下記 |
| ブロックが何をするか（能力フラグ・ブロックテーブル） | **mc-kernel** | `domain/block-registry.ts`。meshing / physics / gameplay は依存グラフ上で互いに届かず、kernel だけが 3 者から見える |
| 次元ごとの Mob 名簿 | **mx-gameplay** | plan.md §7:「次元 → worldgen + sim + gameplay + save（横断）」 |
| THREE.js | **mc-render** | §5 の THREE ゼロ原則 |

### 名詞と動詞の線引き

| これは mc-worldgen（名詞） | これは mx-gameplay（動詞） |
| --- | --- |
| チャンクを生成する / ロード・アンロードする | プレイヤーがブロックを壊したとき何が起きるか |
| ブロックの値を保持し、書き込みを受け付ける（`ChunkStore`） | 何をどういう条件で書き込むか（採掘・設置・落下・流体） |
| 「このチャンクが変わった」を報告する | その報告を受けて砂を落とす |
| ライトグリッドのデータを所有する | 松明を置いたら明るくなる、というルール |
| バイオームを分類する | バイオームで Mob スポーン表が変わる、というルール |
| 生成時に木を配置する | 木を切ると原木がドロップする |
| 生成時に海面まで水を入れる | 水が流れて広がる（流体伝播） |
| **黒曜石の枠がポータルの形をしているか**（`detectNetherPortal`） | **火打ち石でそれに火を点けると何が起きるか** |

## 3. 参照実装から引き継ぐ良い性質

### 3-1. THREE.js を 0 回しか import していない

実測:

```console
$ grep -rnE "from ['\"](three|three/)" packages/world --include='*.ts'
$ echo $?
1     # マッチ無し
```

`packages/world/package.json` の依存は
`@ts-minecraft/{core,block,entity,inventory,worker}` + `effect` のみ。`three` は無い。

意図の証拠（`packages/world/domain/voxel-raycast.ts:3`）:

```
// Voxel ray traversal (Amanatides & Woo). Replaces three.js Raycaster for block
```

### 3-2. 地形定数は注入されていた

`packages/world` 内で `SEA_LEVEL` / `LAKE_LEVEL` を import しているのは
**`domain/terrain/generator-types.ts:3` の 1 箇所だけ**である。
そこで `DEFAULT_TERRAIN_LEVELS`（`:15-18`）になり、以降は引数で流れる:

```typescript
export type TerrainLevels = Readonly<{
  readonly seaLevel: number
  readonly lakeLevel: number
}>
```

`terrain/generator.ts:34`、`tree-placer.ts:194` `:232` などが
`terrainLevels: TerrainLevels = DEFAULT_TERRAIN_LEVELS` を既定引数で受け取る。

この設計のおかげで、超平坦プレビュー・誇張された海のテストフィクスチャ・
将来のカスタムワールド生成設定が、生成コードを触らずに実現できる。

### 3-3. ファイルが細かく割れている

参照実装の `packages/world/domain` + `application` は **195 ファイルで平均 86 LOC**、
非テストの最大ファイルが 335 LOC である。

移植は「巨大ファイルを解きほぐす」作業ではなく
「小さいファイルを大量に運ぶ」作業になる。これは楽なほうである。

### 3-4. 検証はプロパティ / 不変条件ベースだった

参照実装には `*.property.test.ts` が biome-service / noise-service / chunk-terrain-utils /
light-engine-bfs / worker parity に存在する。

参照実装では **ゴールデン / スナップショットテストは 0 件**であった
（`golden|fixture|toMatchSnapshot` の grep が worldgen 関連で 0）。
生成が決定論である以上、当時は埋めるべき穴だった。現在の本リポジトリでは
`test/golden/chunk-goldens.json` と不変条件テストを用いている。→ [testing.md](./testing.md)

## 4. 親・子

### 親（mc-worldgen が依存してよいリポジトリ）

| リポジトリ | 何のために |
| --- | --- |
| `mc-kernel` | `Chunk` データ構造、`BlockType`、能力フラグ、座標系、ブランデッド型。普遍的に import 可 |
| `mc-noise` | `noise2d/3d(seed, x, y, z)`、fBm 合成、密度関数コンビネータ |
| `mc-save` | `defineFormat` でチャンクフォーマットを定義、`StoragePort` に読み書き |

### 子（mc-worldgen に依存するリポジトリ）

| リポジトリ | mc-worldgen をどう使うか |
| --- | --- |
| `mc-sim` | チャンクを読み、ダーティ通知を受ける |
| `mc-render` | チャンクのダーティ購読 → メッシュ更新 |
| `mc-playground-kit` | ミニ平地ワールドの生成 |
| `mx-gameplay` | 地形に対するルールを適用する |
| `mx-redstone` | 同上 |

**5 つのリポジトリが依存する = 界面が動くと 5 箇所に波及する。**
mc-sim ほどではないが、mc-worldgen も依存ハブである。
公開 API は慎重に決めること。

### `ChunkStore` の所有権について（plan.md 未決事項の決着）

plan.md はブロック**書き込み経路**の所有者を §3.7（`ChunkManager` = ここ）と
§3.8（mc-sim = ゲーム状態の中枢）の間で決めていない。
本リポジトリに置くと決めた根拠、そのために plan.md §3.8 の 1 文を
どう解釈したか、逆の選択のコストは
[public-api.md §6-0 〜 §6-2](./public-api.md) にある。**覆すならそこを読むこと。**

### 循環に注意

`mc-playground-kit` は mc-worldgen に依存している。
**mc-worldgen が kit を使うと循環する。** 地形プレビューは kit 無しで作ること。

## 5. 現行実装で意図的に残る未接続部分

| 省略したもの | 理由 | いつ入れるか |
| --- | --- | --- |
| `mc-noise` | **接続済み**。生成コードが公開 sampler を直接利用する | 依存更新時は `package.json` と lockfile を同時に更新する |
| `mc-save` | **接続済み**。`CHUNK_FORMAT` と `StoragePort` を利用する。媒体接続はホストの責務 | ストレージ実装を提供するとき |
| `mc-kernel` | **接続済み**。block ID・座標・定数を利用する。生成中の `Chunk` は別の書き込みバッファ | kernel の型や registry を拡張するとき |
| ~~渓谷カーバー~~ | ~~パイプライン順序が洞窟と違う（木の**後**）なので、木の実装後~~ | **完了**（`domain/ravine.ts`）。深部の溶岩床も実装し、通常地形では到達しない境界をテストで固定。木が宙に残る件だけが残り、理由つきでそのファイルに書いてある |
| ~~要塞のブロック生成~~ | ~~サイト決定のみで、チャンク跨ぎと洞窟との交差規則が未決定~~ | **完了**（`domain/stronghold.ts`）。各チャンクが自分の断面を最終パスで書く |
| ~~deepslate 鉱石 7 種~~ | **完了**。`terrain.ts` の深層岩層と `domain/ore.ts` の 7 variant pair を同じ深度境界で適用する | — |
| ライトグリッド | ~~4bit パックの実装は `packages/block/domain/light.ts` から~~ | **完了**（公開 façade は `src/domain/light.ts`）。常駐チャンク間の伝播、ブロック変更の増分再計算、4bit パックを含む |
| `ChunkStore` の実ストレージ接続 | `PersistentChunkStoreLayer` は `StoragePort` を受け取るが媒体はホストが注入する | ホストが `StoragePort` 実装を提供するとき |

## 6. ポータル: 検出はここ、移動は mx-gameplay

**この節は plan.md §3.11 と矛盾して見える。矛盾していないことを書いておく。**

plan.md §3.11 は「ポータル / 次元移動ルール」を mx-gameplay に割り当てている。
`domain/portal-frame.ts` はその**検出の半分**をここで閉じた。両方が正しい。

### 分割線は参照実装が既に引いていた

| 参照実装のファイル | 何をするか | 行き先 |
| --- | --- | --- |
| `packages/world/domain/nether/portal-frame.ts` | 黒曜石の枠を**認識する** | **mc-worldgen（移植済み）** |
| `packages/app/.../interaction-flint-steel-portal.ts` | 火打ち石の**使用**。上を消費する | mx-gameplay |
| `packages/app/.../physics-stage-portal.ts` | プレイヤーを**動かす** | mc-physics / mc-sim |

3 つのうち `packages/world`（= 名詞の層）に置かれていたのは 1 つだけである。
参照実装は「認識」と「点火」と「移動」を別のパッケージに置いていた。

### mx-gameplay の `docs/testing.md` §3-1 の論拠は、この半分については誤り

あちらは portals を未着手とし、その理由を
「**位置を持つエンティティを動かすものだから** mc-physics / mc-sim のものだ」
と書いている。下 2 行については正しい。`portal-frame.ts` については**偽**である。
このファイルはエンティティを知らない。速度も名簿もプレイヤーも出てこない。
ブロックを読んで矩形を返す。

**一番強い証拠は、移植で消えた 1 行である。** 参照実装の入口は

```
const x = Math.floor(ignition.x)   // portal-frame.ts:133-135
```

で始まる。`Position` が**エンティティの浮動小数座標**だからである。
本リポジトリの引数は `BlockPosition`（`mc-kernel` が安全整数にブランドしている）で、
この `Math.floor` は**することが無くなって消えた**。
参照実装版のこのルールに含まれていた唯一のエンティティ的なものは、
引数に掛けられたキャストだった。

### 逆向きの主張も書いておく（これは弱い）

plan.md §3.7 は本リポジトリに「構造物（村/**ポータル**/End）」を与えている。
だが §3.7 が言っているのは**生成**であって検出ではない。
検出がここにある理由は §3.7 ではなく、上の「入力がブロックデータだけである」ことである。
`generatePortalLayout`（枠の**生成**）のほうは §3.7 が直接の根拠になる。

### 残りの半分は誰のものか

| 参照実装のファイル | 判定 | 根拠 |
| --- | --- | --- |
| `nether-link.ts` の `overworldToNether` / `netherToOverworld` | **ここ** | 8:1 の座標スケーリング。2 つの次元の**座標空間の関係**であって、入力も出力も座標しかない。`chunkCoordOfBlock` と同じ種類のもの → ✅ `domain/nether-link.ts` |
| `nether-link.ts` の `findNearestPortal` | **ここ** | 候補配列を**引数で受ける**純粋な最近傍探索。`BlockAt` と同じ注入形で、台帳そのものは `application/portal-registry.ts` が所有する。`PortalRegistry.resolveTravel` が行き先次元のスナップショットを渡す → ✅ `domain/nether-link.ts` |
| `nether-travel.ts` の `resolveNetherTravel` | ~~**mx-gameplay**~~ → **ここ**（下記 §6-1） | ~~`playerPos` を受けて**プレイヤーをどこへ動かすか**を返す。plan.md §3.11 そのもの。上の 3 つを合成するだけなので、依存の向きも合っている~~ → ✅ `domain/nether-travel.ts` |
| `end/end-portal-frame.ts` | **ここ**（ローカル実装済み） | 参照元と同型の純粋ルールを `domain/end-portal.ts` に移植し、12 枠の向き / 充填状態を検証して中央 3×3 のポータルを materialize する。`endArrivalDescriptor` に End 到着地点の記述も実装済み。スパイク／クリスタル／gateway は `end-features.ts` と `end-gateway.ts` に分離 |

### 6-1. `resolveNetherTravel` の行を覆した。理由と、覆さなかったもの

上の表の 3 行目は **mx-gameplay** と書いてあり、この節はそれを覆している。
覆す側が根拠を書くのが筋なので、まず**覆していない**ほうを書く。

**旧根拠は §6 が正そうとした「カテゴリからの拒否」ではない。**
「`playerPos` を受けて**プレイヤーをどこへ動かすか**を返す」は
plan.md §3.11 の**文の引用**であって、「位置を持つ実体を動かすから」という
確かめられない category ではない。§3.11 は実際に
「ポータル / 次元移動ルール」を mx-gameplay に割り当てている。
だから答えなければならないのは文書のほうで、答えは 3 つある。

**1. 旧根拠の後半が逆を指している。** 「上の 3 つを合成するだけ」——
そしてその 3 つは、**同じ表の上 2 行と `portal-frame.ts` によって全部ここのもの**である。
部品 4 つの全部と別のリポジトリに合成関数を置くのは
「依存の向きが合っている」ではなく、**1 つが越えずに済むように 4 つが境界を越える**ことである。
実際の代償も測れる: mx-gameplay 側は 4 記号のミラーを 1 本増やすことになり、
それは mc-dev-meta の `MIRROR_SPECS` に登録が要り、登録は
「source の barrel にその記号があるか」の照合を通るので、
**mc-worldgen の `index.ts` を動かす**（= `api-lock.md` の 4 週間時計を振り出しに戻す）。

**2. `playerPos` は `BlockPosition` になった。これは §6 が既に一度受け入れた証拠である。**
§6 の検出器についての一番強い論拠は「移植で消えた 1 行」——
参照実装の `Math.floor(ignition.x)` が、引数がブランドされた整数になったことで
することが無くなって消えた、というものだった。**同じことがこの関数でも起きる。**
参照実装の `playerPos: Position` はエンティティの浮動小数座標で、
`domain/nether-travel.ts` の引数はセルである。署名にも本体にもエンティティ的なものは無い。

**3. plan.md §3.11 の「遷移の発火」は別の場所にあり、そこは mx-gameplay である。**
「発火」はタイマーである —— ポータルブロックの中に 4 秒立ち、
そのあと再点火までの冷却がある。それが
`mx-gameplay/domain/portal-dwell.ts`（`stepPortalDwell`）で、座標を 1 つも持たない。
§3.11 はその file によって**満たされている**のであって、こちらに否定されてはいない。
検出（ここ）と点火（mx-gameplay）が別リポジトリに行き、plan.md の 2 通りの読みが
どちらも正しかった §6 本体とまったく同じ形である。

**覆していないもの、3 つ。**

- **両方を `index.ts` から公開した。** `domain/nether-link.ts` の座標変換・最近傍探索と
  `domain/nether-travel.ts` の移動先解決は、同じ責務表でこのリポジトリのものと確定した
  ルールなので、消費側がミラーせず直接利用できる公開契約にした。
- **ポータル一覧の所有者は決まった —— 本リポジトリであり、実装済みである。**
  `findNearestPortal` は今も純粋な候補配列引数を受け取るが、ワールド状態は
  `application/portal-registry.ts` の `PortalRegistry` が所有する。
  `PortalRegistryLayer` はインメモリ、`PersistentPortalRegistryLayer` は
  `mc-save` の `StoragePort` と `PORTAL_REGISTRY_FORMAT` を使う。
  `register` / `unregister` は冪等で、保存成功後に状態を公開する。
  これは `ChunkStore` をここに置いたのと
  同じもので、**ポータルはセーブを跨いで残るワールド状態**であり、本リポジトリは既に
  チャンクのライフサイクルとライトグリッドを同じ理由で所有している。
  参照実装の所有者もサービス（`packages/world/application/nether-service.ts` の
  `getPortals(dimension)`）であり、`packages/world` は本リポジトリである。
  mx-gameplay が持てば、ルールしか持たないリポジトリがワールド状態の第 2 の所有者になる ——
  あちらがバケツとハサミについて拒否した「発明」と同じ形である。

  `resolveTravel` は出発次元に応じて行き先次元の台帳を選ぶ。新しいポータルを
  必要とする計画は返すが、レイアウトをチャンクへ適用したり、生成結果を自動登録したりは
  しない。適用と登録はホストのブロック書き込み境界で行う。

  **実装するときに最初に読むべき危険がこれである。** `knownPortals` は
  **行き先の次元のもの**でなければならない。出発側の一覧を渡すと、
  **いま出ていく世界にあるポータルを黙って再利用する** —— そして
  `BlockPosition` はどの世界のセルかを言わないので、**どの型もこれを捕まえられない**。
  参照実装は呼ぶ前に行き先の `getPortals` を引いている
  （`physics-stage-portal.ts:55-57`）。呼び出し規約であって型ではない、
  というのが `domain/nether-travel.ts` の当該注記の主旨である。

  `PortalRegistry.resolveTravel` はこの規約を内部で満たす。純粋な
  `resolveNetherTravel` を直接呼ぶ場合だけ、呼び出し側が行き先次元の候補を渡す。
- **`Dimension` は借り物ではなくなった —— 本リポジトリが所有する。**
  この箇条書きは以前「借りているだけである」「barrel に出していないので consumer は
  綴りに依存できず、所有者が現れた日に import へ差し替わる」と書いていた。
  所有者は現れず、**決めた**。決め手は新しい実測ではない ——
  §6 本体の実測（mc-kernel に `Dimension` 型は無い）は今も正しく、再実測しても
  `block-registry.ts` の無関係なコメント 1 件だけである。変わったのは論拠のほうで、
  参照実装が `Dimension` を `packages/world`（= 本リポジトリ）に宣言していること、
  そして**その union を読むルールを既に所有しているのは本リポジトリだ**ということ。
  「全員が依存しているから」は所有の理由にならない。
  したがって `index.ts` に出してある（`resolveNetherTravel` も同じ理由で一緒に出た）。
  **出さないことのほうが欠陥になった**からである: mc-sim は
  プレイヤーがどの次元に居るかを記録せねばならず、
  どの barrel も出していない module から取ったミラーは repoint できない。
  代わりに引き受けた危険は plan.md §3.4 の「二つの綴り」であり、
  参照実装自身が 2 回宣言している（`packages/worker/domain/terrain-worker-protocol.ts:18`）。
  消費側は本宣言だけをミラーし、`mc-dev-meta` の `check:mirrors` がそれを機械で固定する。

**「移動そのもの」を止めている名詞も、これで名前がついた。**
mx-gameplay の `docs/testing.md` §3-1 は 3 本目を
「mc-sim の名簿と次元サービス待ち」と書いているが、名簿のほうは誤りである:
参照実装はプレイヤーを名簿では動かさず `gameState.respawn(pos)` を呼んでおり、
mc-sim の対応物は**存在して publish 済み**である
（`PlayerServiceApi.moveTo(feetPosition)`、`mc-sim/application/player-service.ts:25`、
barrel は `index.ts:40`）。**本当に無いのは次元のほう**だった。

**その次元も、いま名前と持ち主がついた。** 語は本リポジトリが所有して publish し
（上の箇条書き）、**状態**は mc-sim が持つ —— `PlayerServiceApi.dimension` /
`setDimension`（`mc-sim/application/player-service.ts`）。語と状態が別の
リポジトリにあるのは分裂ではなく本プロジェクトの通常形であり、
`BlockType` を kernel が所有して `ChunkStore` が値を持つのと同じ形である。

**これで 3 本とも緑になった。** `resolveNetherTravel` の純粋な
`knownPortals` 引数は直接利用する場合の注入点として残り、通常のワールド状態は
`PortalRegistry` が台帳から行き先次元の候補を供給する。既存ポータルは距離内なら再利用され、
無ければ新しいレイアウトが計画される。レイアウトの適用と登録はホストが行う。
