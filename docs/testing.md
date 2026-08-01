# テストと完了条件

## 1. コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）、`tsconfig.test.json`（テスト+ツール）、`tsconfig.preview.json`（`apps/`）の 3 プロジェクト |
| `pnpm lint` | oxlint。このリポジトリ唯一の lint/format 設定（prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別ルールの大半が `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API） |
| `pnpm test:coverage` | カバレッジ計測。**閾値は未設定**（後述） |
| `pnpm verify` | 上記 4 つ（coverage 以外）。CI と同一内容 |
| `pnpm preview` | 内蔵地形プレビュー。**`verify` には入らない**（後述） |
| `pnpm bench` | ベンチマーク（`scripts/bench-terrain.ts`）。**`verify` には入らない**（§7） |
| `pnpm goldens:update` | `test/golden/chunk-goldens.json` を書き直す。**`verify` には入らないし、入れてはならない**——検証がゴールデンを更新できたら、それはゴールデンではない |

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
test/ravine.test.ts              16 tests   渓谷。帯の形 R-1..R-2c、2 層の水ガード R-3..R-5b、
                                            パス順序 R-6..R-8、実チャンク R-9..R-12
test/biome-and-trees.test.ts     14 tests   バイオーム分類の全域性、格子ジッターの間隔
test/vegetation.test.ts          16 tests   草・花 V-1..V-6
test/ore.test.ts                 16 tests   鉱石 O-1..O-5（O-5 は参照実装の帯を再現して赤くなる）
test/structure-siting.test.ts    12 tests   要塞のサイト決定
test/stronghold.test.ts           5 tests   要塞石室、ポータル枠、チャンク境界、最終パス
test/terrain-distribution.test.ts  9 tests   F-1 回帰。広域 SURVEY での高度分布
test/biome-distribution.test.ts  10 tests   F-5 回帰。広域 SURVEY でのバイオーム分布
test/chunk-golden.test.ts        16 tests   シード固定ゴールデン + 独立した裏付け I-1..I-8
test/tree-canopy.test.ts          6 tests   F-2 回帰。生成ブロックでの樹冠連結成分
test/light.test.ts               28 tests   4bit ライトグリッド、setBlock による無効化
test/chunk-store.test.ts         23 tests   ChunkStore
test/chunk-format.test.ts        16 tests   チャンクフォーマット CF-1..CF-16
test/save-format-mirror.test.ts  17 tests   mc-save ミラー SF-1..SF-17
test/api-lock.test.ts            26 tests   API ロックのハーネス
test/kernel-mirror.test.ts       21 tests   BLOCK / ORE_BLOCK / PLANT 番号の mc-kernel との一致
test/portal-frame.test.ts        19 tests   ネザーポータル枠の検出と生成（全サイズ往復 + 変異検証）
test/nether-travel.test.ts       25 tests   8:1 スケーリングの往復、最近傍探索、移動先の解決
                                            （生成したポータルを検出器に通す往復 + 変異検証）
test/vertical-slice.test.ts       4 tests   縦の結合
test/dependency-policy.test.ts   22 tests   16 リポジトリのグラフ、import ゲート
                                 ─────
                                335 tests   全て green
```

> 旧版はここを 132 と書き、次の版は 193 と書き、その次は 214 と書いていた。
> **三つとも実測とずれていた。** 214 の版は 6 ファイル
> （`ore` / `vegetation` / `structure-siting` / `ravine` / `chunk-format` /
> `save-format-mirror`）を数えておらず、`kernel-mirror` も 18 と書いていた（実際は 21）。
>
> **この表は手で保つ限り必ずずれる。** 数えなおしは
> `npx vitest run 2>&1 | grep -E "^ ✓ test/"` の 1 行であり、
> 上の数字はその出力から取ってある。次に触る人も同じことをすること —
> 記憶から書くと 4 回目になる。
> `test/light.test.ts`（28）が後から入り、`test/kernel-mirror.test.ts` は
> 9 → 16 → **18** と伸びている。193 と書かれていた時点の実測は既に 195 だった。
> この表は**手で維持されており、それを検査するゲートは無い**。
> 数字だけを直しても次の PR でまたずれるので、性質として書いておく:
> **この行は `pnpm test` の出力を貼るところであって、記憶から書くところではない。**

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

### `test/portal-frame.test.ts` — 変異させて赤くなることを確認した

`domain/portal-frame.ts` は本リポジトリで初めて「**生成器を持たないルール**」である。
生成物と突き合わせて検証することができないので、代わりに**コードを壊して赤を確認した**。
6 件、全て revert 済み:

| 変異 | 結果 | 落ちたテスト |
| --- | --- | --- |
| リング検査が角を要求するようにする | 🔴 | `does NOT require the four corners` |
| `MIN_PORTAL_WIDTH` 2 → 1 | 🔴 | `refuses frames below the minimum` ほか 2 件 |
| 内部の全面走査を削除 | 🔴 | `refuses an interior with anything in it` |
| 最大サイズのガードを削除 | 🔴 | `refuses frames one cell over the maximum` |
| 点火セルの AIR 検査を削除 | 🔴 | `refuses ignition ON the ring` |
| `BLOCK.OBSIDIAN` 40 → 41 | 🔴 | `assigns the same number to every block` |

**5 番目は最初 🟢 だった。これが本節の要点である。**
AIR 検査を消しても全テストが通った。「点火セルが AIR でない」を主張していた 2 本は、
どちらも**サイズガードのほうで落ちていた**——正しい結論に、間違った理由で到達していた。

実際に AIR 検査だけが止めている入力は 1 つしかない: **リングの下辺の上で点火すること**。
非 AIR セルから下向きに空気を数えると 0 になり、`- 1` が**上に 1 つ動かす**ので、
着地点がちょうど内部の左下隅になる。以降の測定・内部走査・リング検査は全て通り、
黒曜石の上で火を点けたのに 4x5 のポータルが返る。

このテストは変異検証**が見つけた**ものであって、書いてから変異させたのではない。
§4-b F-4（落ちようのないガードを出荷した記録）と同じ穴が、
同じ形でもう一度開いていた。

### `test/nether-travel.test.ts` — 同じ手当てを、参照実装のテストが**無い**ほうにも

`domain/nether-link.ts` と `domain/nether-travel.ts` は
参照実装のテスト 16 本（`packages/world/test/nether-link.test.ts` 10 本、
`nether-travel.test.ts` 6 本）を全部移植した上で 9 本足してある。
足した 9 本のうち 5 本は参照実装が**一度も触っていない性質**で、
`test/portal-frame.test.ts` と同じく変異させて赤を確認した。10 件、全て revert 済み:

| 変異 | 結果 | 落ちたテスト |
| --- | --- | --- |
| `NETHER_HORIZONTAL_RATIO` 8 → 4 | 🔴 9 件 | `is 8` ほか、往復 2 本を含む |
| `Math.floor` → `Math.trunc` | 🔴 2 件 | `floors toward negative infinity`、`Overworld -> Nether -> Overworld is NOT` |
| 半径比較 `>` → `>=` | 🔴 4 件 | `accepts a candidate at exactly the radius` |
| 負の半径ガードを削除 | 🔴 2 件 | `DIVERGENCE: a negative or non-finite radius accepts nothing` |
| 同距離の tie を後勝ちにする | 🔴 2 件 | `keeps the earliest candidate on an exact tie` |
| 距離から Y 項を落とす | 🔴 2 件 | `measures vertically too` |
| `DEFAULT_PORTAL_HEIGHT` 3 → 2 | 🔴 2 件 | `plans a portal that detection actually accepts` |
| `DEFAULT_PORTAL_WIDTH` 2 → 1 | 🔴 2 件 | 同上 |
| 常に overworld → nether にスケールする | 🔴 3 件 | `nether -> overworld scales up` ほか 2 件 |
| ポータル再利用時に**スケール点**へ着く | 🔴 2 件 | `reuses an existing portal near the scaled destination` |

**7 番目と 8 番目が本節の要点である。**
`domain/portal-frame.ts` の寸法ガードのヘッダは MIN 2x3 を「JUSTIFIED」と書き、
その根拠を**参照実装の別ファイル**（`nether-travel.ts:23-24` が自動生成ポータルを
独立に 2x3 と定義していること）に置いていた。**その別ファイルが今このリポジトリにある。**
つまり根拠は引用ではなく**実行できる**ものになり、
`plans a portal that detection actually accepts` が生成 → 検出の往復でそれを固定する。
参照実装の側の主張は `interior` が 6 セルであること（`toHaveLength(6)`）で、
**2x3 を 1x3 や 3x2 に変えても 6 のままか、6 でなくなっても形の誤りは見えない**。
生成器と検出器が同時に壊れることに合意しない限り落ちる、というのが
`test/portal-frame.test.ts` の 760 フレーム掃きと同じ性質である。

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
| ユニットテスト | ✅ 301 tests |
| シード固定ゴールデン | ✅ `test/golden/chunk-goldens.json`（10 チャンク）+ `test/chunk-golden.test.ts`。生成は `pnpm goldens:update` → [design-notes.md DN-9](./design-notes.md#dn-9) |
| バイオーム分布の統計テスト | ✅ `test/biome-distribution.test.ts`。雛形は宣言どおり `test/terrain-distribution.test.ts` で、SURVEY 幅そのものを assert する形も踏襲した。ただし**幅の基準は流用していない**（下記）→ [design-notes.md DN-10](./design-notes.md#dn-10) |
| 内蔵地形プレビュー | ✅ **`apps/preview-terrain/`** |

> **この表の旧版は「バイオームは未実装」と書いていた。これは誤りだった。**
> `domain/biome.ts` の分類器・`BIOME_SURFACES`・`BIOME_TREE_DENSITY` はいずれも実装済みで、
> `generateChunk` は `biomeFor` の結果を柱ごとに `chunk.biomes` へ書き込み、
> 地表ブロックと木の密度の両方をそこから引いている（`domain/terrain.ts:302-307`）。
> `test/biome-and-trees.test.ts`（14 tests）が分類器の全域性を、
> プレビューの `1`（map ビュー）が見た目を、既に押さえていた。
> 欠けていたのは**バイオームそのもの**ではなく**分布の統計テスト**だけである。
> 完了条件 7 も同じ理由で書き直した。

#### 幅の基準を高度版から流用しなかった理由

`test/terrain-distribution.test.ts` は「連続性の特徴 40 個以上」を assert する。連続性が 1/180 だからである。
バイオーム選択が読むのは temperature 1/320・humidity 1/280・continentalness 1/180 の 3 つで、
**拘束するのは一番長い 320** である。180 基準の「40 特徴」は span 7200 を通すが、
7200 は temperature では 22.5 特徴しかない。
別の母集団で測った数字を持ち込む——それは §4-b F-1 の誤りそのものである。
採用値 25 特徴（span 8192）の実測根拠は DN-10 の表にある。

### ゴールデンテストについて ✅

**参照実装にはゴールデン / スナップショットテストが 1 本も無い**
（`golden|fixture|toMatchSnapshot` の grep が worldgen 関連で 0 件）。
検証はプロパティ・不変条件ベースで行われていた。

これは穴であると同時に、安い機会でもある。
生成が決定論であることは既に証明済みなので、

```
固定シード × 座標行列 → blocks の SHA-256 → コミット
```

を置くだけで、**プロパティテストが構造的に検出できないバージョン間ドリフト**を捕まえられる。

実装時の注意——3 つとも守ってある:

- ハッシュは**生成コードで書き出す**こと。手で書かない
  → `scripts/golden-fixture.ts` が計算し、`pnpm goldens:update` が書く
- 更新は必ず意図的な操作にする（`pnpm test -u` で黙って通るようにしない）
  → スナップショット API を一切使わず `toBe` で比較する。`-u` は効かない
- ハッシュが変わったら「地形が変わった」であり、レビュー対象である
  → JSON にダイジェストと**並んで読める要約**（ブロック / バイオームのヒストグラム、
    水面 Y、洞窟帯の空気）を置いてあるので、差分が
    「OCEAN 256 → 31、water 1166 → 0」と読める。`pnpm goldens:update` も何が動いたかを印字する

**ハッシュだけでは足りない**という 4 つ目の注意を足しておく。
ゴールデンは今日のバグに同意する。実際 mc-noise の `buildPermutation` は
ゴールデンと API ロックの両方に守られていて、なお全単射の破れを見られなかった
（`mc-noise/test/permutation.test.ts:5-26`）。
だから各ダイジェストには**コミット済み JSON を読まない独立した不変条件**を付けてある。
一覧と、10 行目が「空虚な合格」の発見で足されたいきさつは
[design-notes.md DN-9](./design-notes.md#dn-9)。

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
| 5 | 木が板になっていない | ✅ | `3`（slice ビュー）。樹冠が 1 本ずつ離れている。**融合していた**が直した（§4-b F-2） |
| 6 | チャンク境界に継ぎ目が無い | ✅ | `b` でチャンク格子。`--stats` の seam 計測 |

3 と 4 は DN-1 / DN-2 の目視版である。両方 green:

- 水面 Y は生成 64 チャンク全体で **min 63 / max 63**。DN-1 のとおり
- ガード ON で shell 内の air は **0**。同じ領域で「水底の 4〜8 ブロック下に洞窟がある列」が
  **2,664 列**あるので、この 0 は空虚ではない。
  `--no-guard` にすると（seed 4242 / 1024 チャンク）**12,856 列**が壊れる

#### ポータル枠（`p` / `k` / `--portal`）

`domain/portal-frame.ts` は生成器を持たないので、**どのシードを飛んでも出てこない**。
`p` は `generatePortalLayout` の出力を**オーバーレイ**として断面図に重ね、
HUD に `detectNetherPortal` の判定をそのまま出す。地形は 1 バイトも書き換えない。

```console
$ pnpm preview --once --ascii --portal --width 44 --height 22
```

**`k` がこの機能の目的である。** リングの下辺から 1 ブロック抜いて、
判定が `NO FRAME` に変わることを目で見る。F-4 の教訓の視覚版である。

そして**プレビューは実際に欠陥を 1 つ出した**（§4-b F-6）。

#### プレビューが見せないもの

正直に書いておく。

- **山脈のシルエット・洞窟内部の眺め**（上記のとおり 3D ではないため）
- **自然構造の描画** — 村・ruined Nether portal・End city / ship の immutable plan と
  チャンク別投影は実装済みだが、このプレビューは plan を地形へオーバーレイしない
- **ポータルは生成されたものではない** — 上記のとおりオーバーレイである。
  「この世界にポータルがある」ことは示していない。示しているのは**ルールの挙動**だけである
- **チャンク境界をまたぐ樹冠** — `plantTree` は隣チャンクのバッファを持たない。
  ただし F-2 の修正後、候補はチャンク境界から 2 ブロック以内に落ちないので、
  **木についてはクリップが起きない**（`test/tree-canopy.test.ts` が固定している）。
  要塞は各チャンクが自分の断面を計算するため境界をまたいで生成できる
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
3. **シード固定ゴールデンハッシュがコミットされている** ✅
   — `test/golden/chunk-goldens.json`（10 チャンク、seed 20260726）。DN-9
4. **ワーカープールのパリティテストが green**
   — Worker の出力がメインスレッドとバイト一致すること。
   参照実装の `terrain-worker-pool.parity.property.test.ts`（124 LOC）の移植
5. ~~カーバー（洞窟 + 渓谷）・植生・鉱石・要塞・ライトグリッド・`ChunkManager`・村・ruined Nether portal・End city / ship の自然構造プラン~~ が実装済み
6. `mc-noise` / `mc-save` / `mc-kernel` への実依存に切り替わっている
   （現在の `domain/seeded-random.ts` `domain/chunk.ts` `domain/biome.ts` の `BLOCK` は仮置き）
7. バイオーム分布の統計テストが green ✅
   — `test/biome-distribution.test.ts`（10 tests）。DN-10
8. カバレッジ 99% ゲートが有効化されている（後述）

## 4-b. プレビューが見つけたもの（テスト未整備の穴）

プレビューを作った目的は絵ではなく、**絵を見て初めて分かることを見ること**である。
以下は `pnpm preview` で実測した、現状のテストが検出できていない事実である。
どれも「今日のコードは今日のコードと等しい」というテストでは出てこない。

### F-1. ✅ 修正済 — 地形シェイパーが世界の 2 割を平らにクランプしていた

**状態**: `CONTINENTALNESS_CONTRAST` を `2.6` → **`1.15`** に変更。
回帰テストは `test/terrain-distribution.test.ts`（9 tests）。

`pnpm preview --view height` を引くと、`!`（`MAX_SURFACE_Y=92` に張り付いた列）の
**巨大な平原**が見えていた。テーブルマウンテンであって山ではない。

`--stats`（8192 ブロック / 16 飛ばし / 262,144 列、seed 20260726）:

| | before (2.6) | after (1.15) |
| --- | ---: | ---: |
| pinned at `MAX_SURFACE_Y` | 9.2% | **0.0019%**（262,144 列中 5 列） |
| pinned at `MIN_SURFACE_Y` | 10.7% | **0.0084%**（22 列） |
| total flat-clamped | **20.0%** | **0.0103%**（27 列） |
| below sea level | 47.5% | 42.9% |
| 高度 p5 / p50 / p95 | 38 / 64 / 92 | 50 / 64 / 79 |

高度ヒストグラムの形が本質である。2.6 では両端に山がある**ほぼ一様**分布
（4 ブロック刻みで、最下バケット 11.8% / 最上バケット 9.2%、間はどれも 4.8〜7.2%）だった。
1.15 では 64 を頂点とする単峰の山になり、裾が `MIN_SURFACE_Y` / `MAX_SURFACE_Y` に
ちょうど届く:

```
  36.. 39   0.03%
  44.. 47   1.87%  #####
  52.. 55  10.06%  #########################
  60.. 63  15.59%  ######################################
  64.. 67  16.20%  ########################################
  72.. 75  11.08%  ###########################
  80.. 83   3.29%  ########
  88.. 91   0.08%
```

#### なぜ間違ったか

定数を正当化しているコメントの**実測値が間違っていた**:

| コメントの主張 | 実測（262,144 列） |
| --- | --- |
| 生の連続性は約 `[0.40, 0.72]` | **`[0.053, 0.946]`**（p5 0.266 / p50 0.496 / p95 0.733） |
| ストレッチ無しだと「海がほぼ無い、海面下 3%」 | **海面下 41.7%** |

コメントは「800×800 ブロックで実測した」と書いていた。
**その窓が小さすぎた** — 周波数 1/180 に対して 800 ブロックは地形 4 個分しかない。
中央値が 0.5 に寄って見えたのは正しいが、裾は測れていない。
裾のある分布に 2.6 を掛ければ両端が飽和する。それが 20% である。

同じ 800 ブロック窓を今測ると生の範囲は `[0.159, 0.833]` になる。
どちらも「フレームに入っていたもの」の正直な測定である。
**生成器の測定になっているのは片方だけである。**
`test/terrain-distribution.test.ts` はこの狭窓再現をテストとして持っている。

#### なぜ 1.15 で、1.0 でも 2.0 でもないのか

| contrast | flat-clamped | below sea level | 実測高度範囲 |
| ---: | ---: | ---: | --- |
| 1.00 | 0.00% | 41.7% | [40, 89] |
| **1.15** | **0.01%** | **42.9%** | **[38, 92]** |
| 1.50 | 1.05% | 44.8% | [38, 92] |
| 2.00 | 8.06% | 46.4% | [38, 92] |
| 2.60 | 19.96% | 47.5% | [38, 92] |

- contrast は**海の割合をほとんど動かさない**（42%〜47%）。海面が高度範囲の
  ほぼ中央にあるからである。動かすのは「世界の何割が平らか」だけである。
  だから 5 ポイントの海のために地表の 20% を払うのは悪い取引である
- ただし 1.0 では生の裾が高度 40 と 89 にしか届かず、`MIN_SURFACE_Y` /
  `MAX_SURFACE_Y` は**どの列も到達しない架空の境界**になる。
  1.15 は両端に届く最小の値であり、その代金は 1 万列に 1 列である

seed 20260726 / 1 / 4242 / 999983 / 77777 の 5 シードで測って、
flat-clamped は全て 0.00〜0.01%、海面下は 41.2〜42.9% だった。

#### 副作用として記録しておくこと

- **BEACH が増えた**（7.1% → 15.9%、OCEAN は 43.9% → 35.1%）。
  `biomeFor` の BEACH 帯は海面 ±2 ブロックの固定幅なので、
  勾配が緩くなれば同じ幅がより広い面積を占める。バイオーム分類は触っていない
- **カーバーのコストが上がった**。`MIN_SURFACE_Y` に張り付いた列が消えたぶん、
  洞窟帯 y=6..58 に石が増え、カーバーが空気を見つけて skip する回数が減る。
  §7 の baseline を更新した（`carveCaves/re-carve-warm-buffer` +34%）
- F-3 の「洞窟が海底のマージンに触るのは通常運転」は**弱まった**。
  原点 8×8 チャンクでは「水底の 4〜8 ブロック下に洞窟がある列」が 2,664 → 0 になる。
  `test/carver.test.ts` は fixture を**探索する**方式なので影響を受けない
  （±16 チャンクを走査して、ガードを外すと実際に床が抜ける座標を見つける）

### F-2. ✅ 修正済 — 樹冠が融合していた（plan.md §3.7 が防ごうとした失敗そのもの）

**状態**: `TREE_GRID_SIZE` を 4 → **8**、`TREE_CELL_JITTER_SPAN = 3` を新設、
`BIOME_TREE_DENSITY` の FOREST 0.04 → **0.012** / TAIGA 0.03 → **0.009**。
回帰テストは `test/tree-canopy.test.ts`（6 tests）。

`domain/tree-placement.ts` のヘッダは、格子ジッター配置が
「One tree per grid cell, jittered inside the cell, **bounds the minimum spacing by construction**」
だと書いていた。**この文は偽だった。**

格子ジッターが構成的に抑えるのは**密度**であって最小間隔ではない。
隣接セルの候補は 1 ブロックまで近づける（`TREE_GRID_SIZE = 4`、セル内ジッターは 0..3）。

| | before | after |
| --- | ---: | ---: |
| 最近傍間隔 min / p50 / max（Chebyshev、384×384） | **1** / 3 / 14 | **6** / 7 / 10 |
| 樹冠が隣と重なる木 | **75.6%** | **0.0%** |
| 最大の樹冠クラスタ | 119 本 | **1 本** |
| 1 Y・1 チャンクの LEAVES 連結成分 | **78 ブロック** | **20 ブロック** |
| 384×384 の本数 | 815 | 419 |

**樹冠 1 個は 21 柱**（5×5 から四隅を除いた形）だが、幹が自分の樹冠の Y まで届いていて
`plantTree` は AIR にしか葉を書かないので、**LEAVES としては 20** である。
before の 78 は 4 個ぶんが繋がっていた。
しかもそれは**チャンク内**の計測なので境界をまたぐ塊を数え落としており、
実際はそれより悪かった。

#### 直し方 — ジッターをセル内の窓に閉じ込める

セルの縁に候補が入れない溝を残すと、隣接セル間の距離に下界が付く:

```
TREE_MIN_SPACING = TREE_GRID_SIZE - TREE_CELL_JITTER_SPAN + 1 = 8 - 3 + 1 = 6
                >= 2 * TREE_CROWN_RADIUS + 2 = 6
```

`2r + 1` では足りない。ちょうど `2r + 1` だと両樹冠の端の柱が隣り合って 4-連結する。

この下界は**候補格子**の上で、密度ロール・バイオーム・水没のどのゲートよりも前に
成り立つ。以降のゲートは候補を減らすだけなので、下界は全部を通過しても生き残る。
だから「パイプライン全体を再現しなくても検査できる」不変条件になっている。

#### 密度には幾何学的な上限がある

間隔 6 を守る配置は最大でも 1/36 ≒ **0.0278 本/柱**しか置けない。
FOREST 0.04 と TAIGA 0.03 は**この上限を超えていた** —
融合しない樹冠では原理的に実現できない密度を要求していたのであり、
葉の板はそれを正直に実現した結果である。ここが F-2 の核心である。

上限内だった SAVANNA 0.008 / PLAINS 0.006 / SNOW 0.004 は**据え置き**である。
変換が `density × TREE_GRID_AREA`（単位**面積**あたり）なので、
セルが 4×4 → 8×8 になってもこの 3 つの本数は変わらない。

#### 副作用として記録しておくこと

`TREE_GRID_SIZE` が `CHUNK_SIZE_XZ` を割り切り、ジッター窓が
`TREE_CELL_JITTER_ORIGIN = 2 >= TREE_CROWN_RADIUS` だけ内側に寄っているので、
**候補はチャンク境界から 2 ブロック以内に落ちない**。
結果として「境界をまたぐ樹冠がクリップされる」問題（下の「プレビューが見せないもの」）は
木については消えた。`test/tree-canopy.test.ts` が
`leafBlocks === trees × 20` を主張してこれを固定している。
`ChunkManager` が要るのは、これより大きい構造物が来たときである。

### F-3. カーバーのガードは常時働いている（良い知らせ）

`CAVE_CEILING_Y = 58` は `SEA_LEVEL = 63` より下で、浅瀬の海底は 55〜58 に来る。
つまり**洞窟が海底のマージンに触るのは稀な境界事例ではなく、通常運転**である。

チャンク (0..7, 8..15) の 16,384 列:

```
submerged columns with air inside the 3-block shell: 0
submerged columns with a cave 4..8 blocks below the water floor: 2664
```

> **F-1 修正後の追記。** この 2,664 は `CONTINENTALNESS_CONTRAST = 2.6` 時代の数字である。
> クランプが消えて海底が浅くなったので、洞窟の天井 `CAVE_CEILING_Y = 58` と水底の距離が
> 広がり、原点 8×8 チャンクでは同じ計測が **0** になる。
> 「通常運転」は「起きうる」に弱まった。
> ただし `test/carver.test.ts` は座標を**探索して** fixture を見つける方式
> （しかも「ガードを外すと実際に床が抜ける」ことを探索条件にしている）なので、
> テストは空虚にならずに green のままである。fixture が移動しただけである。

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

> **追記——この F-4 がテストを 1 本空虚にした。**
> ゴールデン行列の最初の 9 チャンクは、規則（バイオームごとに原点最寄り）で選んだ結果
> 全部この「ガードの出番が無い」領域に入っていた。
> そのため「水域下のシェルが中実である」という不変条件は、
> `carveCaves` からガードを削っても **16 件中 16 件 green のまま**だった。
> 実際に削って確認した。
> 10 番目の行 (4, 9) はガードが効く座標で、マージン 0 にすると 256 柱中 229 柱が抜ける。
> F-4 は「ガードが無意味に見える」という**観察**として書かれていたが、
> 実際には「その領域で書いたガードのテストは空虚になる」という**テスト設計上の警告**でもある。
> → [design-notes.md DN-9](./design-notes.md#dn-9)

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

> **✅ 追記——書いた。`test/biome-distribution.test.ts`。**
> 上の助言には落とし穴が 1 つあった。「周波数」が単数形である。
> バイオーム選択は temperature 1/320・humidity 1/280・continentalness 1/180 の
> **3 つの場**を読むので、拘束するのは一番長い 320 である。
> 高度版の「連続性の特徴 40 個」を流用すると span 7200 が通り、
> それは temperature では 22.5 特徴しかない——
> **別の母集団で測った定数を持ち込む F-1 の誤りの、3 度目**になるところだった。
>
> また、span を振って実測したところ **4096 まで狭めても 8 バイオーム全部が全シードで出る**。
> つまり F-5 の「消失」は 384 という極端な窓でないと起きず、
> 広げることで買えるのは存在ではなく**希少バイオームの割合の安定性**である
> （DESERT のシード間ばらつきが span 4096 で 20 倍、8192 で 3.4 倍）。
> 採用した「25 特徴」はその実測から選んである。表は
> [design-notes.md DN-10](./design-notes.md#dn-10)。
>
> ついでに、本節が 384 窓について記録している「8 個中 6 個」を再測定すると **5 個**になる
> （SAVANNA も消える）。狭い窓の数字は再現しないという、この節自身の主張の実例である。

### F-6. ✅ 修正済 — 十字線がポータルのリングを上書きしていた

**状態**: `views.ts` の `renderSlice` 末尾の十字線ループが、
オーバーレイ込みのアクセサではなく**素の地形**を読んでいた。修正済み。

`--portal` を付けた最初のフレームの下辺がこう出た:

```
..................O|OOOO....
```

リングの下辺 6 マスのうち、カメラ列の 1 マスが `|` になっている。
十字線は「カメラ列が**空気なら**印を打つ」ものであり、
その座標の**素の地形**は空気で、黒曜石なのは**オーバーレイだけ**だったからである。

これが本物の欠陥だったのは、隠していたブロックが
**`k` が抜くまさにそのブロック**（下辺の中央）だったからである。
`k` を押しても絵が変わらないプレビューになるところだった——
「動いているように見えて死んでいる機能」（§3 の海面マーカー）の再演である。

**このリポジトリのテストはこれを検出できない。** `apps/` は typecheck / lint /
check:deps の対象ではあるが、`vitest` の `include` は `test/**` だけであり、
プレビューの描画にテストは 1 本も無い。§3 の「プレビューはゲートではない」は
そのとおりだが、F-6 は**ゲートでないものが唯一の検出器だった**例である。

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

### baseline を一度更新した（§4-b F-1 の修正）

`CONTINENTALNESS_CONTRAST` を 2.6 → 1.15 にすると、`MIN_SURFACE_Y` に張り付いた列が
消えるぶん洞窟帯 y=6..58 に**石が増える**。カーバーは空気を見つけて skip する代わりに
実際に書き込むようになるので、carve が重くなる。5 回通しの中央値で:

| workload | before | after | |
| --- | ---: | ---: | --- |
| `carveCaves/re-carve-warm-buffer` | 3.436 | **4.611** | +34% |
| `generateChunk/no-decorate` | 13.690 | **14.233** | +4% |
| `generateChunk/full` | 16.370 | 16.302 | −0.4%（**据え置き**） |

`generateChunk/full` が動かないのは、増えた埋めと carve の分を
**木が 3 分の 1 に減った**分（FOREST 密度 0.04 → 0.012）が払っているからである。
guard 2 本とサンプリング 2 本は 5% 以内なので**更新していない**。
`fbm2D` は触っていないのだから、動いていない数字を録り直すのはゲートを下げるだけである。

**測定時の落とし穴**: `recordedOn` は Node 22.23.1 である。Node 24 で同じ
**無変更の** `fbm2D` を測ると `shipped-vs-frozen` が 1.23 → 0.99 になり、ゲートが落ちる。
`recordedOn` と違う node で出た数字は何も意味しない。

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
