# テストと完了条件

## 1. コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）、`tsconfig.test.json`（テスト+ツール）、`tsconfig.preview.json`（`apps/`）の 3 プロジェクト |
| `pnpm lint` | oxlint。このリポジトリ唯一の lint/format 設定（prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 66 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API） |
| `pnpm test:coverage` | カバレッジ計測。**閾値は未設定**（後述） |
| `pnpm verify` | 上記 4 つ（coverage 以外）。CI と同一内容 |
| `pnpm preview` | 内蔵地形プレビュー。**`verify` には入らない**（後述） |
| `pnpm bench` | ベンチマーク（`scripts/bench-terrain.ts`）。**`verify` には入らない**（§7） |

`pnpm` は PATH に無い場合がある。`corepack pnpm <cmd>` で 9.15.0 が起動する。

### プレビューはゲートではないが、野放しでもない

`pnpm preview` は `pnpm verify` に入っていない。人間が見るものであり、
CI が pass/fail を判定できるものではないからである。

ただし `apps/` は**他の 3 つのゲート全部の対象**にしてある:

- `pnpm typecheck` — `tsconfig.preview.json`（`tsconfig.build.json` とは**別プロジェクト**）
- `pnpm lint` — `oxlint ... apps`
- `pnpm check:deps` — `SCAN_ROOTS` に `apps` が入っている

`tsconfig.build.json` に `apps/**` を足さなかったのは意図的である。
あのプロジェクトが `types: []` と `"DOM"` 無しの `lib` を継いでいることが、
「出荷ドメインはプラットフォーム非依存である」ことの**証明**になっている。
`apps/` を混ぜたらその証明が消える。

`tsconfig.preview.json` も `lib` に `"DOM"` を足していない。
プレビューはターミナルに描くので、ブラウザの型を 1 つも必要としない。

## 2. 現状のテスト

```
test/determinism.test.ts          7 tests   (seed, coords) → Chunk の決定論、継ぎ目
test/terrain-levels.test.ts       6 tests   SEA_LEVEL=63 の補正、水位不変条件
test/carver.test.ts               6 tests   hollow-lake 回帰（バグの再現つき）
test/biome-and-trees.test.ts     13 tests   バイオーム分類の全域性、格子ジッター
test/dependency-policy.test.ts   22 tests   16 リポジトリのグラフ、import ゲート
                                 ─────
                                 54 tests   全て green
```

### 重要なテスト 3 本

**`test/terrain-levels.test.ts`** — plan.md §3.7 の誤った定数を固定し直す。
`not.toBe(48)` / `not.toBe(62)` を明示的に書いてあるのは、
plan.md を読んだ誰かが「修正」しに来たときに落ちるためである。
→ [design-notes.md](./design-notes.md#dn-1)

**`test/carver.test.ts`** — hollow-lake 回帰。
同じチャンクをガード有り・無しで生成し、
**無しのほうで実際にバグが再現することを主張する**。
バグを再現できない回帰テストは、今日のコードが今日のコードと等しいことしか言わない。
→ [design-notes.md](./design-notes.md#dn-2)

**`test/determinism.test.ts`** — 全ての土台。
セーブファイルは地形ではなくシードを保存するので、生成のぶれは全ワールドの遡及的破壊になる。

### fixture は探索する

`test/carver.test.ts` は「洞窟が水域の下を通っているチャンク」を
座標を走査して探す。ハードコードしない。
地形シェイパーを調整したときにテストが壊れるのではなく、fixture が移動する。

## 3. plan.md §3.7 が要求する検証

> **検証**: ユニット + シード固定ゴールデン（バイオーム分布の統計テスト含む）+
> **内蔵地形プレビュー**（シード/バイオーム選択→フライカメラで生成結果を飛び回れる。
> **本計画の最初の遊べる成果物**）

| 要求 | 状態 |
| --- | --- |
| ユニットテスト | ✅ 54 tests |
| シード固定ゴールデン | ⬜ **未実装** |
| バイオーム分布の統計テスト | ⬜ 未実装（`pnpm preview --stats` が**計測**はするが assert はしない） |
| 内蔵地形プレビュー | ✅ **`apps/preview-terrain/`** |

### ゴールデンテストについて

**参照実装にはゴールデン / スナップショットテストが 1 本も無い**
（`golden|fixture|toMatchSnapshot` の grep が worldgen 関連で 0 件）。
検証はプロパティ・不変条件ベースで行われていた。

これは穴であると同時に、安い機会でもある。
生成が決定論であることは既に証明済みなので、

```
固定シード × 座標行列 → blocks の SHA-256 → コミット
```

を置くだけで、**プロパティテストが構造的に検出できないバージョン間ドリフト**を捕まえられる。

実装時の注意:

- ハッシュは**生成コードで書き出す**こと。手で書かない
- 更新は必ず意図的な操作にする（`pnpm test -u` で黙って通るようにしない）
- ハッシュが変わったら「地形が変わった」であり、レビュー対象である

### 地形プレビュー: `apps/preview-terrain/` ✅

plan.md §2.3-4:「プレビューは検証対象と同居する」。
plan.md §4.1 の配置規約どおり `apps/preview-terrain/` に置いた。
パッケージではなく、`index.ts` からも公開されない**このリポジトリ内の dev アプリ**である。

**mc-playground-kit は使っていない。** kit は mc-worldgen に依存しているので循環する。
自前で組んである。**依存は増えていない**（org パッケージ 0、npm 依存 0）。

詳細は [`apps/preview-terrain/README.md`](../apps/preview-terrain/README.md)。

#### 3D ではなくターミナルに描いた

`three` をプレビューにだけ足す案は却下した。
`tsconfig.base.json` の `lib` に `"DOM"` が無いことが THREE 非依存の**機構的保証**であり、
3D プレビューはどこかの tsconfig にそれを戻すことを要求するからである
（機構的保証 → 誰かが守る約束、への格下げ）。
加えて、下の 3 と 4 は断面図なら一目で分かり、一人称視点では掘らないと分からない。

**見えないもの**: 山脈のシルエット、洞窟の内側からの眺め。
3D プレビューは mc-render ができたときにそちらに置くのが正しい。

#### 6 点の到達状況

| # | 確認事項 | 状態 | 見かた |
| --- | --- | --- | --- |
| 1 | シードを入れて生成し、飛び回れる | ✅ | `--seed` / `wasd` `q` `e` `-` `=` / `[` `]` |
| 2 | バイオームを可視化できる | ✅ | `1`（map ビュー）。HUD に構成比 |
| 3 | **海面が 63 だと目で分かる** | ✅ | `3`（slice ビュー）。左の目盛りの `63>` の行と水面が一致する |
| 4 | **湖底に穴が空いていない** | ✅ | `3` で水域の下。`g` でガードを切ると穴が空く |
| 5 | 木が板になっていない | ⚠ | 見える。そして**融合している**（下記） |
| 6 | チャンク境界に継ぎ目が無い | ✅ | `b` でチャンク格子。`--stats` の seam 計測 |

3 と 4 は DN-1 / DN-2 の目視版である。両方 green:

- 水面 Y は生成 64 チャンク全体で **min 63 / max 63**。DN-1 のとおり
- ガード ON で shell 内の air は **0**。同じ領域で「水底の 4〜8 ブロック下に洞窟がある列」が
  **2,664 列**あるので、この 0 は空虚ではない。
  `--no-guard` にすると（seed 4242 / 1024 チャンク）**12,856 列**が壊れる

#### プレビューが見せないもの

正直に書いておく。

- **山脈のシルエット・洞窟内部の眺め**（上記のとおり 3D ではないため）
- **渓谷・草花・鉱石・構造物・ライトグリッド** — まだ生成側に無い（責務表参照）
- **チャンク境界をまたぐ樹冠** — `plantTree` が隣チャンクのバッファを持たないので
  クリップされる。プレビューはその**クリップされた結果**を正しく描いている。
  境界をまたぐ木は `ChunkManager` の仕事であり、まだ存在しない
- **時間変化** — 何も無い。`(seed, coord)` の純関数にアニメーションさせるものは無い

#### `--stats` は 2 種類の走査をする

連続性ノイズの周波数は 1/180、つまり**地形 1 個が 180 ブロック**である。
384×384 の密な走査から「世界の何割が海か」を読むと、
それは世界ではなく**丘 2 個**の記述になる。このレポートの初版は実際にそれを間違え、
「DESERT と SNOW は到達不能」という**誤った結論**を出した。
8192 ブロックまで広げたら 8 バイオーム全部が出た。

分布を測るときは `SURVEY`（疎・広）、隣接が要るものだけ `LOCAL`（密・狭）。
**この区別を持たない統計テストを書くと同じ罠を踏む。**

## 4. 完了条件

このリポジトリが「完成」と言えるのは以下が全て満たされたときである。

1. `pnpm verify` が green ✅
2. **地形プレビューが操作可能**（上記 6 点を目視確認できる）✅
   — plan.md §6 Step 2:「worldgen の地形プレビューが最初の遊べる成果物」
   — `apps/preview-terrain/`。**plan.md §6 Step 2 の完成条件の片翼はこれで満たした**
3. **シード固定ゴールデンハッシュがコミットされている**
4. **ワーカープールのパリティテストが green**
   — Worker の出力がメインスレッドとバイト一致すること。
   参照実装の `terrain-worker-pool.parity.property.test.ts`（124 LOC）の移植
5. カーバー（洞窟 + 渓谷）・植生・鉱石・構造物・ライトグリッド・`ChunkManager` が実装済み
6. `mc-noise` / `mc-save` / `mc-kernel` への実依存に切り替わっている
   （現在の `domain/seeded-random.ts` `domain/chunk.ts` `domain/biome.ts` の `BLOCK` は仮置き）
7. バイオーム分布の統計テストが green
8. カバレッジ 99% ゲートが有効化されている（後述）

## 4-b. プレビューが見つけたもの（テスト未整備の穴）

プレビューを作った目的は絵ではなく、**絵を見て初めて分かることを見ること**である。
以下は `pnpm preview` で実測した、現状のテストが検出できていない事実である。
どれも「今日のコードは今日のコードと等しい」というテストでは出てこない。

### F-1. 地形シェイパーが世界の 2 割を平らにクランプしている

`pnpm preview --view height` を引くと、`!`（`MAX_SURFACE_Y=92` に張り付いた列）の
**巨大な平原**が見える。テーブルマウンテンであって山ではない。

`--stats`（8192 ブロック / 16 飛ばし / 262,144 列、seed 20260726）:

```
pinned at MAX_SURFACE_Y   9.2%   pinned at MIN_SURFACE_Y  10.7%   total flat-clamped  20.0%
```

原因は `domain/terrain.ts` の `CONTINENTALNESS_CONTRAST = 2.6` である。
そしてこの定数を正当化しているコメントの**実測値が間違っている**:

| コメントの主張 | 実測（262,144 列） |
| --- | --- |
| 生の連続性は約 `[0.40, 0.72]` | **`[0.053, 0.946]`**（p5 0.266 / p50 0.496 / p95 0.733） |
| ストレッチ無しだと「海がほぼ無い、海面下 3%」 | **海面下 41.7%** |

コメントは「800×800 ブロックで実測した」と書いている。
**その窓が小さすぎた** — 周波数 1/180 に対して 800 ブロックは地形 4 個分しかない。
中央値が 0.5 に寄って見えたのは正しいが、裾は測れていない。

裾のある分布に 2.6 を掛ければ両端が飽和する。それが上の 20% である。
`stretch` の閾値は `0.3077` と `0.6923` で、実測分布はその外に十分な質量を持っている。

**これは「直せ」ではない。** 定数の値は設計判断であり、
海面下 47.5%（現状）と 41.7%（ストレッチ無し）のどちらが欲しいかは決めの問題である。
言えるのは**判断の根拠になった数字が間違っている**ということだけである。
→ 定数を触るなら、まず `--stats` を取り直すこと。

### F-2. 樹冠は融合している（plan.md §3.7 が防ごうとした失敗そのもの）

`domain/tree-placement.ts` のヘッダは、格子ジッター配置が
「One tree per grid cell, jittered inside the cell, **bounds the minimum spacing by construction**」
だと書いている。**この文は偽である。**

格子ジッターが構成的に抑えるのは**密度**であって最小間隔ではない。
隣接セルの候補は 1 ブロックまで近づける（`TREE_GRID_SIZE = 4`、セル内ジッターは 0..3）。

実測（384×384 の密走査、815 本）:

```
nearest-neighbour spacing (Chebyshev): min 1  p50 3  max 14
trees whose radius-2 crown overlaps a neighbour's:  75.6%
```

列座標だけの計測は樹冠が別々の高さにある可能性を無視するので、
ブロックバッファでも測った（64 チャンク）:

```
largest 4-connected LEAVES patch at one Y in one chunk: 78 blocks   (one crown is 21)
```

**樹冠 1 個は 21 ブロック**（5×5 から四隅を除いた形）である。78 は 4 個ぶんが繋がっている。
しかもこれは**チャンク内**の計測なので、境界をまたぐ塊は数え落としており、
実際はこれより悪い。

つまり `tree-placer.ts:184-188` が
「Independent per-column rolls at forest-like rates fused the radius-2 crowns into a walkable leaf slab」
と警告した状態に、**格子ジッターを入れた後でもまだ到達している**。
格子は Bernoulli より良いが、`TREE_GRID_SIZE=4` と半径 2 の樹冠の組み合わせでは足りていない。

回帰テストにするなら「1 つの Y・1 チャンクの LEAVES 連結成分は 21 を大きく超えない」が形である。

### F-3. カーバーのガードは常時働いている（良い知らせ）

`CAVE_CEILING_Y = 58` は `SEA_LEVEL = 63` より下で、浅瀬の海底は 55〜58 に来る。
つまり**洞窟が海底のマージンに触るのは稀な境界事例ではなく、通常運転**である。

チャンク (0..7, 8..15) の 16,384 列:

```
submerged columns with air inside the 3-block shell: 0
submerged columns with a cave 4..8 blocks below the water floor: 2664
```

`WATER_FLOOR_MARGIN = 3` は**水底ブロックを含めて 3 枚**である
（帯は `[waterFloorY - 3, waterFloorY)` で `waterFloorY = surfaceY + 1`、
つまり `surfaceY-2 .. surfaceY`）。`surfaceY - 3` は保護されない。
断面図で見ると、砂 3 枚の下がすぐ洞窟という場所が延々と続く。
仕様どおりであり、参照実装の定数どおりでもある。

ただし帰結は記録しておく価値がある: **mx-gameplay がブロック破壊や流体伝播を入れたとき、
海底の砂を 1 枚壊すと洞窟が水没する**。生成のバグではない。設計の帰結である。

### F-4. デフォルトシードの原点付近ではガードの出番が無い

seed 20260726 の (0,0) 周辺 64 チャンクでは、`--no-guard` にしても出力が 1 ビットも変わらない。
洞窟が水域の床の 3 ブロック以内に来ないからである。

**`g` を押して何も起きないことをもって「ガードが無意味」と結論しないこと。**
出番のある座標は `apps/preview-terrain/README.md` に書いた。

### F-5. 走査窓が狭いと統計は嘘をつく

このレポート自身が最初にやった間違いである。
384×384 で測ったとき「DESERT 0.0% / SNOW 0.0%、到達可能バイオームは 8 個中 6 個」
という結果が出た。`classifyBiome` の閾値と付き合わせると
「`climateAt` に `stretch` が掛かっていないので極端気候に届かない」という
もっともらしい原因まで書けてしまった。

8192 ブロックまで広げたら **8 個中 8 個**が出た（DESERT 0.1%、SNOW 0.8%）。
最初の結論は**窓が地形 2 個ぶんしかなかったこと**の記述だった。

「バイオーム分布の統計テスト」（完了条件 7）を書く人へ:
**走査窓は最低でも周波数の逆数の数十倍取ること。** そうでないと
テストは地形ではなくノイズ格子の数点を固定する。

## 5. カバレッジ閾値: 今はまだ設定しない

参照実装は branches / functions / lines / statements の 99% を強制している。
mc-worldgen でも**最終的には同じ 99% を課す**が、今は課さない。

理由: スケルトンに閾値を課しても意味が無い。
型定義だけのモジュールをいくつか置けば簡単に満たせてしまい、
実装の品質について何も語らない数字になる。

現状:

- 計測とレポートは**常に動いている**（`pnpm test:coverage`、CI でもアーティファクト化）
- 閾値だけが未設定。`vitest.config.ts` の `coverage.thresholds` がコメントアウトされている
- CI の `Coverage` ステップも同様

**有効化のタイミング**: 上記「完了条件」の 1〜7 を満たした時点で、
`vitest.config.ts` と `.github/workflows/ci.yaml` の**両方**を同時に更新する。

```typescript
thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
```

## 6. テストの書き方の規約

### `@effect/vitest` の `it.effect` を使う

```typescript
it.effect('name', () => Effect.gen(function* () { ... }).pipe(Effect.provide(SomeLayer)))
```

`generateChunk` は同期関数なので、多くのテストは `Effect.sync(() => { ... })` になる。
`Effect.gen` で `yield*` しないと oxlint の `require-yield` が警告する。

### 不変条件はチャンク全走査で

`never places water above LAKE_LEVEL, anywhere, in any chunk` は
16×16×(256-64) を 3 チャンク分走査する。遅いが、故障は「どこかに 1 ブロック」なので
スポットチェックでは見つからない。

参照実装も同じ判断をしていた
（`packages/world/test/terrain-water-level-invariant.test.ts:28`）。

### 空虚な成功を防ぐ

不変条件テストには「条件を満たすデータが実際に存在すること」を主張するテストを添える:

- `does put water somewhere, so the sweep above is not vacuously true`
- `finds submerged columns to test against, so the rest is not vacuous`

水が 1 つも生成されなければ「`LAKE_LEVEL` を超える水は無い」は自明に真である。

### 回帰テストには「なぜ」を書く

参照実装の挙動を固定するテストには、
**どのファイルの何行目を固定しているのか**をコメントに残すこと。
根拠を失ったテストは、次のリファクタで「よく分からないので消す」対象になる。

このリポジトリの既存テストは全てこの形式で書かれている。

### 大きいバッファに注意

1 チャンクは 64KB である。fixture 探索が数百チャンクを走査すると数百 MB を触る。
`test/carver.test.ts` は結果をメモ化してある。

## 7. ベンチマーク（`pnpm bench`）

### 参照実装の `bench-terrain.ts` が**ここ**に来た理由

参照実装の `scripts/bench-terrain.ts` は
`generateTerrainBlocks({coord, seaLevel, lakeLevel, seed})` を計測している——
チャンクのブロック配列を返す関数である。

これを mc-noise に置くことはできない。mc-noise にはチャンクもブロック ID も海面も
バイオームも無く、`(seed, coordinate) -> number` のライブラリでしかないからである。
本リポジトリの `generateChunk` が参照実装の `generateTerrainBlocks` **そのもの**である:
同じ作業単位、同じ入力、同じ 16×16×256 の出力。だからこれは移植であって類推ではない。

mc-noise 側にはオクターブループとカラムサンプリングのベンチマークが別に入っている。
分担はコードの実態どおりで、**mc-noise がサンプラを、mc-worldgen がチャンクを持つ**。

### 何を測っているか

`scripts/bench-terrain.ts`。手法は参照実装のもの——**ウォームアップののち 9 回計測しその中央値**。
座標を散らして毎回別のチャンクを生成するのも参照実装の規則の移植である
（原文: "Spread coords so each call generates a distinct chunk (avoids any incidental caching)"）。
チャンク (0,0) を 200 回生成しても、測れるのは温まった格子ハッシュのキャッシュであって地形生成ではない。

参照実装は 1 行の per-chunk 値を出すだけだったが、ここでは
`generateChunk` が実際に走らせるパスごとに**内訳**を出している。
「1.4 ms/chunk」は、それが 4 ms/chunk になったときにどこを見ればいいかを何も教えないからである。

シードは定数 `20260726`。そもそも `pnpm check:deps` が
`Date.now()` / `new Date()` / `performance.now()` をリポジトリ全体で禁じている
（ベンチマークハーネスの 1 行だけが `mc-kernel-allow-time-source` で明示的に除外されている）。

### guard —— `domain/seeded-random.ts` のオクターブ例外

`fbm2D` は `let` + `for` で書かれており、そのコメントは
「mc-noise が継ぐ前にここで規約を確立しておくためにこう書いてある」と述べている。
**コメントで確立した規約は、リファクタ 1 回で失われる規約である。**
そこで mc-noise と同じ shipped-vs-frozen ゲートを `fbm2D` にも当てている:
出荷している `fbm2D` を、**その現在の形をそのまま凍結したコピー**と比較する。

書き換え版とだけ比較しても足りない。比はどちらの辺が変わっても同じ向きに動くからである。

### 実測値（Apple M4 Max / Node 22.23.1、5 回通しの中央値）

| guard | 比 |
| --- | --- |
| `fbm-octave-loop/array-from-reduce-vs-imperative` | **4.1x** |
| `fbm-octave-loop/shipped-vs-frozen-imperative` | 1.23（ゲート） |

| workload | ms/chunk | x81 |
| --- | --- | --- |
| `sample/surfaceHeightAt-per-chunk-columns` | 0.041 | 3.3 ms |
| `sample/climateAt-per-chunk-columns` | 0.055 | 4.4 ms |
| `generateChunk/no-decorate` | 0.167 | 13.5 ms |
| `carveCaves/re-carve-warm-buffer` | 0.044 | 3.6 ms |
| `generateChunk/full` | **0.188** | **15.2 ms** |

`generateChunk/full` が参照実装の `generateTerrainBlocks` に対応する行である。

ゲートが 1.00 ではなく 1.23 なのは、この engine では出荷側の import のほうが
ローカルのコピーよりわずかによく最適化されるためで、`fbm2D` の性質ではない。
重要なのは値が安定していること（5 回通しの散らばり 6%）と、`fbm2D` が遅くなれば潰れることである。

### 読み方の注意 2 点

- **`generateChunk/no-decorate` にも carve は入っている。** `generateChunk` で
  オプションなのは装飾だけで、`carveCaves` は常に走る。差分（0.188 − 0.167）は
  木の配置パスの費用である。
- **`carveCaves/re-carve-warm-buffer` は carve パスの下限であって費用ではない。**
  `carveCaves` は in-place で、プールのバッファは生成時に既に carve 済みである。
  `computeWaterFloorYs` の走査も密度場の評価も満額かかるが、内側の書き込みは
  石ではなく空気を見つけて skip する分だけ少ない。走査とノイズ——時間が消えている場所——は変わらない。
  タイマの内側でチャンクを生成すれば「生成 + carve」を carve と呼ぶことになり、そちらのほうが悪い。

### ゲートが実際に落ちることの確認

`domain/seeded-random.ts` の `fbm2D` を `Array.from().reduce` に書き換えて実行した:

```
REGRESSED  fbm-octave-loop/shipped-vs-frozen-imperative     observed 0.324   baseline 1.228  (0.26x)
REGRESSED  fbm-octave-loop/array-from-reduce-vs-imperative  observed 1.006   baseline 4.129  (0.24x)
REGRESSED  sample/surfaceHeightAt-per-chunk-columns         observed 10.629  baseline 3.251  (3.27x)
REGRESSED  sample/climateAt-per-chunk-columns               observed 18.137  baseline 4.479  (4.05x)
```

4 件の regression と exit 1。`generateChunk/full` の workload 比は 16.37 → 31.554、
すなわち **1.93 倍**になった（yardstick 正規化済みの比なので、これは機械に依らない）。
同じ run で shipped-vs-frozen が 0.324 まで落ちている、つまり `fbm2D` 自体は 3.09 倍。
`f × 3.09 + (1 − f) = 1.93` を解くと `f ≈ 0.44` ——
**このループ 1 つが `generateChunk` 全体のおよそ 44% を占めている。**

なお `generateChunk/full` 自身は 1.93x で workload tolerance 2.00 をわずかに下回り、
単独では落ちていない。落としたのは guard 2 本とサンプリング workload 2 本である。
「一番太い線が一番鈍い」——だから内訳と guard の両方が要る。

### ベンチが**できない**こと

wall-clock は粗い道具である。tolerance より安い書き換えはすり抜けうる。
**綴りの不変条件は型システムと design-notes の名前付き回帰テストの仕事**であって、
このファイルはそれに値札を付ける。

### `verify` に入っていない理由と、CI について

このリポジトリは public で、CI は **`pull_request` ごとに**走る。
ベンチマークは 4 秒前後だが、共有ランナーの実時間は負荷で揺れるので、
workload 比は CI ではここで測ったより不安定になる。

**推奨**: いま CI ジョブを足すべきではない。`domain/` の生成パスに触る PR で
人間が走らせるものとして扱う。足すとしても `push` on `main` か nightly にして、
`--workload-tolerance` を緩め guard だけを見る形が妥当である。

### baseline の更新手順

```console
$ pnpm bench --update-baseline
```

`BENCH_MACHINE` 環境変数に機械の説明を入れると `recordedOn` に記録される。
**更新は必ず、何がどう動いたかをコミットメッセージに書いて行うこと。**
baseline を黙って上書きするのは、ベンチマークを削除するのと同じである。
