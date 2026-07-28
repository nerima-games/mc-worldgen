# 移植元

参照実装: `takeokunn/ts-minecraft`（凍結。仕様書 + テストオラクルとして扱う）。

**LOC は全て `wc -l` の実測値である。plan.md の見積もりは信用しないこと。**

---

## 0. plan.md §3.7 の LOC 表記について

> plan.md §3.7 移植元:
> `packages/world` の domain/application
> （biome-classifier.ts / biome-properties.ts / terrain-generation.ts / chunk-manager-service.ts 等、
> **~13k LOC**）

**この見積もりは正確である。** 実測:

| 範囲 | LOC | ファイル数 |
| --- | ---: | ---: |
| `packages/world/domain/**/*.ts` | 10,820 | 109 |
| `packages/world/application/**/*.ts` | 5,997 | 86 |
| **合計** | **16,817** | 195 |
| **合計（`*.test.ts` を除く）** | **13,035** | 156 |

plan.md の `~13k` は「テストを除いたソース」と一致する。

ただし注意点が 2 つある:

1. 195 ファイルのうち **39 が `domain/` `application/` 直下に同居する `*.test.ts`**（3,782 LOC）
2. テストの本体は別ディレクトリにあり、
   **`packages/world/test/` だけで 21,302 LOC / 135 ファイル** —
   **カバー対象のソースより大きい**

つまり移植の総量は 13k ではなく、テストを含めれば 34k である。

## 1. ファイルサイズの分布

**非テストの最大ファイルが 335 LOC。195 ファイルの平均が 86 LOC。**

移植は「巨大ファイルを解きほぐす」作業ではなく
「小さいファイルを大量に運ぶ」作業になる。これは楽なほうである。

### domain + application の最大 25 ファイル

| LOC | パス |
| ---: | --- |
| 396 | `packages/world/domain/chunk.test.ts` |
| 335 | `packages/world/domain/noise-primitives.ts` |
| 276 | `packages/world/application/block-service.config.ts` |
| 265 | `packages/world/domain/terrain/plant-placement-rules.ts` |
| 250 | `packages/world/domain/terrain/tree-placer.ts` |
| 245 | `packages/world/application/block-service-place-plan.ts` |
| 217 | `packages/world/domain/biome-classifier.ts` |
| 212 | `packages/world/domain/chunk-coord-utils.test.ts` |
| 203 | `packages/world/domain/terrain/surface-resolver.ts` |
| 200 | `packages/world/application/block-service-break-helpers.ts` |
| 193 | `packages/world/domain/terrain/nether-generator.ts` |
| 189 | `packages/world/domain/terrain/generator-coordinates.ts` |
| 188 | `packages/world/domain/nether/portal-frame.ts` |
| 187 | `packages/world/domain/terrain/ore-generator.ts` |
| 184 | `packages/world/application/chunk-manager-ops.ts` |
| 181 | `packages/world/domain/terrain/generator.ts` |
| 175 | `packages/world/application/noise-service.ts` |
| 174 | `packages/world/domain/terrain/stronghold.ts` |
| 170 | `packages/world/domain/fire-lifecycle.ts` |
| 168 | `packages/world/domain/biome-service-helpers.ts` |
| 168 | `packages/world/application/fluid-service-runtime-io.ts` |
| 162 | `packages/world/domain/world-metadata-model.ts` |
| 161 | `packages/world/domain/terrain/nether-fortress.ts` |
| 158 | `packages/world/domain/chunk-coord-utils.ts` |
| 153 | `packages/world/domain/falling-block.test.ts` |

## 2. mc-worldgen に来ないもの（重要）

`packages/world` の全てが mc-worldgen に来るわけではない。

| 対象 | LOC 目安 | 行き先 | 理由 |
| --- | ---: | --- | --- |
| `noise-primitives.ts` ほかノイズ群 | 335+ | **mc-noise** | plan.md §3.2 |
| `infrastructure/`（ストレージ） | 535 | **mc-save** | plan.md §3.5 |
| `world-metadata-model.ts` | 162 | **mc-sim / mc-save** | ワールドメタデータは worldgen の関心ではない |
| `block-service*.ts` | 700+ | **mx-gameplay** | ブロックの破壊・設置は動詞 |
| `fluid-service*.ts` | 168+ | **mx-gameplay** | 流体伝播は動詞（plan.md §3.11） |
| `falling-block.ts` | 153+ | **mx-gameplay** | 落下ブロックは動詞 |
| `fire-lifecycle.ts` | 170 | **mx-gameplay** | 動詞 |

**実際に mc-worldgen に来るのは 13k のうちおよそ 8〜9k である。**
残りは他リポジトリへ散る。

## 3. 中核（最優先で読む）

| LOC | パス | 役割 | 状態 |
| ---: | --- | --- | --- |
| 217 | `packages/world/domain/biome-classifier.ts` | 気候→バイオーム。ルールテーブル `:44-79`、6 入力版 `:96` | ✅ 2 入力版のみ |
| 181 | `packages/world/domain/terrain/generator.ts` | パイプライン本体。**パス順序が `:102` と `:155`** | ✅ 簡易版 |
| 203 | `packages/world/domain/terrain/surface-resolver.ts` | 表面材質の決定 | ⬜ |
| 189 | `packages/world/domain/terrain/generator-coordinates.ts` | 座標変換 | ⬜ |
| — | `packages/world/domain/terrain/generator-types.ts` | **`TerrainLevels` と `DEFAULT_TERRAIN_LEVELS` (`:10-18`)。SEA/LAKE_LEVEL の唯一の import 元 (`:3`)** | ✅ |
| — | `packages/world/domain/density-function.ts` | `computeColumnYFromValues` `:42-55`。スプラインベース高さ | ⬜ |
| — | `packages/world/application/terrain-generation.ts` | `generateTerrainBlocks` `:120`、入力 Schema `:36-47` | ✅ 相当 |

## 4. カーバー（**最も価値が高い**）

| LOC | パス | 役割 | 状態 |
| ---: | --- | --- | --- |
| 109 | `packages/world/domain/terrain/cave-carver.ts` | **水床ガード `:70-74`、`computeWaterFloorYs` `:18-32`** | ✅ |
| 68 | `packages/world/domain/terrain/ravine-carver.ts` | **2 層ガード `:41-46`。biome だけでは不十分だった証拠** | ⬜ |
| — | `packages/world/domain/terrain/constants.ts` | `CAVE_WATER_FLOOR_MARGIN = 3` (`:50`)、経緯コメント `:47-49` | ✅ |

→ [design-notes.md](./design-notes.md#dn-2)

## 5. 植生

| LOC | パス | 役割 | 状態 |
| ---: | --- | --- | --- |
| 250 | `packages/world/domain/terrain/tree-placer.ts` | 格子ジッター `:169-179`、3 ゲート `:189-220`、設計根拠 `:184-188` | ✅ 配置のみ |
| — | `packages/world/domain/terrain/tree-placer.config.ts` | 定数 `:26-41`、注記 `:30-34` | ✅ |
| 265 | `packages/world/domain/terrain/plant-placement-rules.ts` | 草・花 | ✅ 地被のみ → `domain/vegetation.ts` |
| 114 | `packages/world/domain/terrain/plant-placement-model.ts` | 密度表 `:66-75`、salt `:30-31` | ✅ 密度を転記 |
| 108 | `packages/world/domain/terrain/plant-placement-ops.ts` | `placeGroundPlant` `:82-89` | ✅ 地被のみ |
| 187 | `packages/world/domain/terrain/ore-generator.ts` | 鉱石 | ✅ 石変種 7 種 → `domain/ore.ts` |

### 5-1. 植生・鉱石で**移植しなかった**もの

| 未移植 | 理由 |
| --- | --- |
| サトウキビ / サボテン / スイレン / キノコ | 依存するバイオーム（SWAMP / JUNGLE / RIVER / FLOWER_FOREST）が本リポジトリの名簿に無いか、要求する土台を生成していない |
| 昆布 / 海草 | 水中カラムの規則が要る。`plant-placement-ops.ts:32-52` の水クッション判定ごと |
| deepslate 鉱石 7 種（kernel 57-63） | 置く先の deepslate 層が無い。`DEEPSLATE_CEILING = 16` は**石の事実**であって鉱石の事実ではない |
| `redstone_ore` の `lightEmission: 9` | `domain/kernel-vocabulary.ts` の発光表は 3 行のまま。DN-7 の保守側なので出荷可。`test/kernel-mirror.test.ts` が明示的に記録している |

## 6. 構造物

| LOC | パス | 状態 |
| ---: | --- | --- |
| 174 | `packages/world/domain/terrain/stronghold.ts` | 🟡 サイト決定のみ → `domain/structure-siting.ts`。ブロック生成器は未移植 |
| — | **村** | ⬜ **参照実装に存在しない**。実測: `packages/world` の「village」4 箇所は全て作物のコメント + Mob 名。移植ではなく新規設計 |

| LOC | パス |
| ---: | --- |
| 193 | `packages/world/domain/terrain/nether-generator.ts` |
| 188 | `packages/world/domain/nether/portal-frame.ts` |
| 174 | `packages/world/domain/terrain/stronghold.ts` |
| 161 | `packages/world/domain/terrain/nether-fortress.ts` |
| — | `packages/world/domain/end/end-portal-frame.ts` |

**注意**: 要塞・寺院の位置決めもワールド座標のみの純関数で、シードを含まない（DN-6 参照）。

## 7. ライトグリッド

| LOC | パス | 注意 |
| ---: | --- | --- |
| 211 | **`packages/block/domain/light.ts`** | **`packages/world` ではない。** 4bit パック `:93-108` |
| 151 | `packages/world/domain/sky-light-bfs.ts` | `propagateSkyLightIncremental` `:33` |
| 132 | `packages/world/domain/block-light-bfs.ts` | `propagateBlockLightIncremental` `:32` |
| 76 | `packages/world/domain/light-engine-helpers.ts` | |
| 33 | `packages/world/domain/light-engine-model.ts` | `BoundaryDirty` `:24-29` |
| 30 | `packages/world/domain/light-engine-utils.ts` | int32 パック `:22-26`、閾値 `:6` |
| 32 | `packages/world/application/light-engine-service.ts` | タグ `:12` |
| **665** | **小計** | |

→ [public-api.md](./public-api.md) §8

## 8. チャンクライフサイクル

| LOC | パス | 役割 |
| ---: | --- | --- |
| — | `packages/world/application/chunk-manager-service.ts` | タグ `:26`、メソッド `:65-86`、`makeSemaphore(4)` `:45` |
| 184 | `packages/world/application/chunk-manager-ops.ts` | ライフサイクル文書 `:125-132`、`getChunk` `:133-137` |
| 63 | `packages/world/application/chunk-manager-ops-storage.ts` | **`healHollowWaterBeds` `:54-60`（名前の無いマイグレーション）** |
| 54 | `packages/world/application/chunk-manager-cache.ts` | LRU |
| 158 | `packages/world/domain/chunk-coord-utils.ts` | 座標ユーティリティ |

## 9. ワーカープール

| LOC | パス |
| ---: | --- |
| 48 | `packages/worker/application/terrain-worker-pool-port.ts` |
| 124 | `packages/worker/test/terrain-worker-pool.parity.property.test.ts` |

**パリティテストは必ず移植すること。** これが無いと
「Worker 経路だけで地形が変わる」バグが本番でしか見つからない。

## 10. テスト資産（移植価値順）

`packages/world` のテストは **164 ファイル**（`test/` に 135、domain/application 直下に 39）。
うち worldgen 関連はおよそ 108 本。

| LOC | パス | なぜ最優先か |
| ---: | --- | --- |
| 43 | `packages/world/test/terrain-determinism.test.ts` | シード→バイト一致。異なるシードが異なることも主張 |
| 124 | `packages/worker/test/terrain-worker-pool.parity.property.test.ts` | **唯一のパリティテスト** |
| — | `packages/world/test/terrain-water-level-invariant.test.ts` | `:28` チャンク全走査で `LAKE_LEVEL` 超えの水が無い |
| 224 | `packages/world/test/cave-carver.test.ts` | `:201` hollow-lake 回帰 |
| 95 | `packages/world/test/ravine-carver.test.ts` | `:75` 湖底の回帰 |
| — | `packages/world/test/generator-pipeline.test.ts` | end-to-end の柱 assertion |
| — | `packages/world/test/tree-placer.test.ts` | |
| — | `packages/world/test/surface-resolver.test.ts` / `-biome-edge.test.ts` | |
| — | `packages/world/test/density-function.test.ts` | |

### ゴールデン / スナップショットテストは 0 件

`golden|fixture|toMatchSnapshot` を `packages/world/test` と `packages/worker` で grep しても、
worldgen 関連のスナップショットテストは出てこない。
ヒットするのはヘルパーモジュール（`chunk-buffer-test-utils.ts` 等）と無関係の fluid/idb テストだけである。

検証はプロパティ・不変条件ベースで行われていた
（`*.property.test.ts` が biome-service / noise-service / chunk-terrain-utils /
light-engine-bfs / worker parity に存在する）。

**これは mc-worldgen が埋めるべき穴であり、同時に安い機会でもある。**
生成が決定論であることは証明済みなので、
「固定シード × 座標行列に対する `blocks` の SHA」をコミットしておけば、
プロパティテストが構造的に検出できないバージョン間ドリフトを捕まえられる。

## 11. 移植の進め方

1. **`generator-types.ts` を読む** — `TerrainLevels` の注入パターン。数分で終わる（✅ 完了）
2. **`cave-carver.ts` (109) と `ravine-carver.ts` (68) を読む** —
   合計 177 LOC で、このリポジトリで最も価値の高いバグ修正が 2 つ入っている（✅ 洞窟のみ完了）
3. **`tree-placer.ts:169-220` と `tree-placer.config.ts` を読む** —
   格子ジッターの数式と定数（✅ 完了）
4. **`biome-classifier.ts` (217) を読む** — ルールテーブルと 6 入力版（✅ 2 入力版のみ）
5. **`density-function.ts:42-55` を読む** — スプラインベースの高さ場（⬜）
6. **`generator.ts` (181) を読む** — パス順序。`:102` と `:141-155` のコメントが本体（⬜）
7. **`packages/block/domain/light.ts` (211) を読む** — 4bit パック（⬜）
8. **`chunk-manager-ops.ts` (184) を読む** — mc-save 消費開始後（⬜）

### そのまま移植してはいけないもの

| 対象 | 理由 |
| --- | --- |
| `packages/world/domain/perlin.ts:42` の `rand ?? Math.random` | シード未指定フォールバック。**シードを必須にして削除する**（DN-6） |
| `chunk-manager-ops-storage.ts:54-60` の `healHollowWaterBeds` | 名前もバージョンもテストも無いマイグレーション。mc-save の `defineFormat` 連鎖で表現する |
| `ravine-carver.ts:42` の biome だけのガード | **不十分**。`:46` のブロック検査も必ず一緒に持ってくる（DN-2） |
| 木・構造物の位置決めがシードを含まない点 | 変えたいなら意図的に。移植ではなく挙動変更であると認識すること |
