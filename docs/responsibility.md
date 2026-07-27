# 責務

出典: plan.md §3.7。参照実装の実コードで補正した箇所には根拠を付けてある。

## 1. 責務（plan.md §3.7 原文）

> バイオーム分類・地形生成・カーバー（洞窟/渓谷）・植生・**構造物（村/ポータル/End）**・
> チャンクのライフサイクル管理。永続化は mc-save のツールキットでチャンクフォーマットを定義

### 具体的に持つもの

| 要素 | 説明 | 状態 |
| --- | --- | --- |
| 地形定数 | `SEA_LEVEL` / `LAKE_LEVEL` を `TerrainLevels` として注入 | ✅ |
| 決定論シード | `(seed, coords) → Chunk` の全域性 | ✅ |
| バイオーム分類 | 気候 → バイオーム（ルールテーブル、first-match-wins） | ✅ 2 入力版 |
| 地形生成 | 高さ場 → ブロック充填 → 水位 | ✅ |
| カーバー（洞窟） | **水域の床マージン検査つき** | ✅ |
| カーバー（渓谷） | 同上 | ⬜ |
| 植生（木） | 格子ジッター配置 | ✅ 配置ロジック |
| 植生（草・花） | | ⬜ |
| 鉱石 | | ⬜ |
| 構造物（村 / ポータル / End / 要塞） | ポータルは**枠の検出だけ** `domain/portal-frame.ts`。生成器はまだ無い | 🟡 検出のみ |
| ライトグリッド | BFS 光伝播、4bit パック。**データはここが所有** | ⬜ |
| `ChunkStore`（= plan.md §3.7 の `ChunkManager`） | ロード / アンロード / **ブロック書き込み** / ダーティチャンネル。`application/chunk-store.ts` | ✅ 永続化を除く |
| ワーカープール Port | 実装は利用側が注入 | ⬜ |
| チャンクフォーマット定義 | mc-save の `defineFormat` で | ⬜ |
| 地形プレビュー | **本計画の最初の遊べる成果物**。`apps/preview-terrain/`（dev アプリ、公開 API ではない） | ✅ |

## 2. 非スコープ（ここに書いたら負け）

| 非スコープ | 正しい置き場 | 理由 |
| --- | --- | --- |
| ジオメトリ生成（メッシング） | **mc-meshing** | チャンクデータを作るのはここ、面を作るのは meshing |
| ライトの**適用**（描画） | **mc-render** | plan.md §7:「ライティング → worldgen（データ）+ render（適用）」 |
| ノイズ関数そのもの | **mc-noise** | 現在の `domain/seeded-random.ts` は mc-noise 到着までの仮置き |
| 永続化の機構 | **mc-save** | worldgen は `defineFormat` で**フォーマットを定義するだけ** |
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

`packages/world/domain` + `application` は **195 ファイルで平均 86 LOC**、
非テストの最大ファイルが 335 LOC である。

移植は「巨大ファイルを解きほぐす」作業ではなく
「小さいファイルを大量に運ぶ」作業になる。これは楽なほうである。

### 3-4. 検証はプロパティ / 不変条件ベースだった

`*.property.test.ts` が biome-service / noise-service / chunk-terrain-utils /
light-engine-bfs / worker parity に存在する。

**ゴールデン / スナップショットテストは 0 件**である
（`golden|fixture|toMatchSnapshot` の grep が worldgen 関連で 0）。
生成が決定論である以上、これは埋めるべき穴である。→ [testing.md](./testing.md)

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

## 5. スケルトン段階で意図的に省いたもの

| 省略したもの | 理由 | いつ入れるか |
| --- | --- | --- |
| `mc-noise` への依存 | 未 publish（plan.md §6 Step 0）。`domain/seeded-random.ts` が仮置き | mc-noise が消費可能になった時点 |
| `mc-save` への依存 | 同上 | mc-save が消費可能になった時点 |
| `mc-kernel` への依存 | 同上。`domain/chunk.ts` `domain/biome.ts` の `BLOCK` が仮置き | kernel が消費可能になった時点 |
| 渓谷カーバー | パイプライン順序が洞窟と違う（木の**後**）ので、木の実装後 | 植生の後 |
| 構造物 | 単体で大きい。地形が安定してから | 地形プレビューの後 |
| ライトグリッド | 4bit パックの実装は `packages/block/domain/light.ts` から | チャンクフォーマット確定後 |
| `ChunkStore` の永続化（`unload` が保存しない） | 永続化（mc-save）が要る | mc-save 消費開始後。ストレージ読み出しは `ChunkSource` の前段に合成され、`ChunkStoreApi` は変わらない |

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
本リポジトリの引数は `BlockPosition`（`kernel-vocabulary.ts` が安全整数にブランドしている）で、
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
| `nether-link.ts` の `overworldToNether` / `netherToOverworld` | **ここ**（未移植） | 8:1 の座標スケーリング。2 つの次元の**座標空間の関係**であって、入力も出力も座標しかない。`chunkCoordOfBlock` と同じ種類のもの |
| `nether-link.ts` の `findNearestPortal` | **ここ**（未移植、ただし注記つき） | 候補配列を**引数で受ける**最近傍探索。`BlockAt` と同じ注入形。ただし「世界に存在するポータルの一覧」を**所有する**のが誰かは別問題で、それはまだ誰にも割り当てられていない |
| `nether-travel.ts` の `resolveNetherTravel` | **mx-gameplay** | `playerPos` を受けて**プレイヤーをどこへ動かすか**を返す。plan.md §3.11 そのもの。上の 3 つを合成するだけなので、依存の向きも合っている |
| `end/end-portal-frame.ts` | **ここ**（未移植、意図的） | 形は `portal-frame.ts` と同型（注入された `BlockAt` の純粋ルール）なので境界の議論は同じ結論を出す。移植しなかったのは**規模の理由**である: End 次元も要塞生成器も `end_*` ブロックも本リポジトリにまだ無いので、生産者も消費者も無いルールを 1 本増やすことになる。構造物（End）に着手する時に一緒に来るのが正しい |

`nether-travel.ts` が mx-gameplay だと言えるのは、そこに `Dimension` 型と
`playerPos` が出てくるからである。**mc-kernel には `Dimension` 型が無い**
（実測: `grep -rn "Dimension" mc-kernel/domain/*.ts` は 1 件のコメントのみ）。
次元を跨ぐ移動を書く側が、まずその語彙を kernel に要求することになる。
