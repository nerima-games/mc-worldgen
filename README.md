# @nerima-games/mc-worldgen

## 責務

バイオーム分類・地形生成・カーバー（洞窟/渓谷）・植生・構造物（村/ポータル/End/自然構造）・
チャンクのライフサイクル管理。永続化は mc-save のツールキットでチャンクフォーマットを定義する。

## ⚠ plan.md §3.7 の地形定数は**両方とも誤りである**

plan.md §3.7 の「設計注意(参照実装の実測知見)」— **回帰テスト化せよと指示されたセクション**
にこう書いてある:

> 地形定数: `SEA_LEVEL=48`、`LAKE_LEVEL=62`

**両方とも間違っている。** 参照実装 `packages/core/domain/constants.ts`:

```
:17  export const SEA_LEVEL = 63
:20  export const LAKE_LEVEL = SEA_LEVEL
```

| | plan.md §3.7 | 実物 |
| --- | ---: | --- |
| `SEA_LEVEL` | 48 | **63**（バニラ Minecraft と同じ） |
| `LAKE_LEVEL` | 62 | **63**。しかも**独立した定数ではなく `SEA_LEVEL` そのもの** |

plan.md の値でテストを書くと、誤りが「検証済みの仕様」に昇格して固定される。
さらに「湖面が海面より 14 ブロック高い」という、参照実装に一度も存在しなかった
世界観が生まれ、誰も要求していない分岐コードがそれを根拠に書かれる。

正しい理解は「**湖面と海面は同一である。両者を区別する定数は存在しない**」。

`test/terrain-levels.test.ts` が `not.toBe(48)` / `not.toBe(62)` を明示的に主張している。
plan.md を読んだ誰かが「修正」しに来たら落ちる。
→ [docs/design-notes.md](./docs/design-notes.md#dn-1)

## 依存

`effect`、`@nerima-games/mc-kernel`（普遍）、`@nerima-games/mc-noise`、`@nerima-games/mc-save`。

**import してはならないもの**: `mc-meshing`（ジオメトリは meshing と render の仕事）、
`mc-sim` / `mc-render`（逆向きのエッジ = 循環）、`three`（下記）。

mc-worldgen に依存するのは sim / render / playground-kit / mx-gameplay / mx-redstone の **5 つ**である。

## THREE.js を import しない

参照実装の `packages/world` は THREE.js を **0 回**しか import していない（実測確認済み）。
この分離があるから世界生成は Worker でも Node でも canvas 無しのテストでも走る。

mc-worldgen では**機構にしてある**: `tsconfig.base.json` の `lib` に `"DOM"` を入れていないので、
`new THREE.Vector3()` はこのリポジトリのどこにも書けない。

## ドキュメント

実装に必要な情報は全て [`docs/`](./docs/) にある。**plan.md を読み直す必要は無い。**

| ファイル | 内容 |
| --- | --- |
| [docs/architecture.md](./docs/architecture.md) | 4 階層、16 リポジトリ依存グラフ、mc-worldgen の位置 |
| [docs/responsibility.md](./docs/responsibility.md) | 責務と非スコープ |
| [docs/public-api.md](./docs/public-api.md) | 公開 API（参照実装で検証済み） |
| [docs/design-notes.md](./docs/design-notes.md) | 設計注意 + 回帰テスト。**plan.md の補正はここ** |
| [docs/porting.md](./docs/porting.md) | 移植元と実測 LOC |
| [docs/testing.md](./docs/testing.md) | 検証要件と完了条件 |
| [docs/versioning.md](./docs/versioning.md) | 0.x → 1.0.0、**地形変更は semver で表現しきれない** |

## カーバーの水域床ガードは「移植すべき修正」である

plan.md §3.7 はこれを「参照実装の重大バグ」と書いているが、
参照実装は**既に修正済みで、回帰テストまで付いている**
（`cave-carver.ts:70-74`、`cave-carver.test.ts:201`）。

しかも修正には非自明な後半がある。`ravine-carver.ts:41-46` のコメントが
「biome が OCEAN か RIVER か」で判定するだけでは**不十分だった**ことを記録している。
`PLAINS` の窪地にできた湖は水没しているが `OCEAN` でも `RIVER` でもないからである。

**ブロックバッファを直接見るガードも一緒に移植すること。**
→ [docs/design-notes.md](./docs/design-notes.md#dn-2)

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_24 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 24 以上と pnpm 11（`corepack` 推奨）を用意する。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷）、`tsconfig.test.json`（テスト+ツール）、`tsconfig.preview.json`（`apps/`）の 3 プロジェクト |
| `pnpm build` | `dist/index.js`（ESM）と `dist/index.d.ts`（宣言）を生成し、公開成果物を検査可能にする |
| `pnpm lint` | oxlint（唯一の lint/format 設定）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別ルールの大半が `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect`） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | Vitest + V8 カバレッジ。branches / functions / lines / statements の 100% を要求 |
| `pnpm verify` | `typecheck`、`lint`、`test:coverage`、`build`。CI と同じ品質ゲート |
| `pnpm preview` | **内蔵地形プレビュー**（下記）。`verify` には入らない |

### 地形プレビュー

```console
$ pnpm preview                  # 対話モード。wasd で飛び回る
$ pnpm preview --help           # キー割り当てとオプション
$ pnpm preview --stats          # 絵ではなく数値レポート
$ pnpm preview --once --ascii   # 1 フレームを文字で標準出力へ
```

3 つのビュー: `map`（真上・バイオーム色）、`height`（表面高度・海面で色が切り替わる）、
`slice`（垂直断面・**実際の `generateChunk` のブロック**）。

**3D ではなくターミナルに描いてある。** `three` をプレビューにだけ足す案は却下した
（`lib` に `"DOM"` が無いことが THREE 非依存の機構的保証であり、それを崩すため）。
理由と、失われたもの（山脈のシルエット、洞窟内部の眺め）は
[`apps/preview-terrain/README.md`](./apps/preview-terrain/README.md) に書いてある。

依存は `mc-kernel`（ブロック・チャンク型）、`mc-noise`（ノイズ）、`mc-save`（保存形式・永続化）を
直接利用する。生成ロジックはこれらの API を再実装せず、ドメイン固有の地形・構造・配置に集中する。

### 構成

```
index.ts                          公開バレル
domain/
  constants.ts        SEA_LEVEL=63、TerrainLevels、チャンクレイアウト
  biome.ts            バイオームロスター、表面材質、mc-kernel の block ID
  chunk.ts            生成用ブロック・バイオームバッファ
  vegetation-data.ts 植物・植生ルールのデータ
  carver.ts           洞窟カーバー ★水域床ガード
  tree-placement.ts   格子ジッター配置
  terrain.ts          generateChunk(seed, coords)
  end-terrain.ts      generateEndChunk(seed, coords)
  nether-terrain.ts   generateNetherChunk(seed, coords)
apps/
  preview-terrain/    内蔵地形プレビュー（dev アプリ。公開 API ではない）
scripts/
  golden-fixture.ts / update-goldens.ts  ゴールデン管理
  bench-*.ts                         ベンチマーク
test/                             Vitest の不変条件・統合テスト
docs/                             実装情報
```

### `no-bitwise` はこのリポジトリだけ off

`.oxlintrc.json` で `"no-bitwise": "off"` にしてある（他 15 リポジトリでは warn）。
理由はそこにコメントで書いてある: シード PRNG が 32bit 整数演算を必要とし、
ライトグリッドが 4bit パックを必要とするためである。
oxlint 0.12 にパス単位のルール上書きが無いので、この粒度が上限である。

## 現状

**現在の実装状態。** Overworld / Nether / End の決定論的な地形生成、主要なカーバー・植生・
構造配置（Overworld stronghold / desert pyramid / igloo / jungle pyramid / mineshaft / ocean ruin / ocean monument / pillager outpost / shipwreck / Nether fortress / bastion remnant を含む）、End のスパイク／クリスタル計画、ライト、チャンクストア、保存形式定義を実装し、
依存パッケージの API を直接利用している。

- ✅ **地形プレビューは実装済み** — `apps/preview-terrain/`。
  plan.md §6 Step 2 の「最初の遊べる成果物」であり、
  **完成条件 2（プレビューが操作可能）はこれで満たした**。
  mc-playground-kit は使っていない（kit が worldgen に依存しているので循環する）
- ✅ **シード固定ゴールデンハッシュは実装済み** — `test/golden/chunk-goldens.json`、
  `scripts/golden-fixture.ts`、`pnpm goldens:update`。参照実装には 1 本も無い。
  各ダイジェストには**独立した不変条件**が付いている（`test/chunk-golden.test.ts` I-1..I-8、
  `test/ore.test.ts` O-1..O-5、`test/vegetation.test.ts` V-1..V-6）。
  ダイジェスト単独では「今日のバグ」をそのまま記録するだけなので、
  ゴールデンを動かすときは**先に不変条件で正しさを示す**
- **実装済み**: `ChunkStore`（plan.md §3.7 の `ChunkManager`）— ロード / アンロード /
  ブロック書き込み / ダーティチャンネル。所有権の根拠は [docs/public-api.md](./docs/public-api.md) §6-0
- ✅ **実装済み**: ライトグリッド（公開 API は `src/domain/light.ts`、実装は `src/domain/light-grid.ts`・
  `src/domain/light-propagation.ts`・`src/domain/light-update.ts`）、草・花（`domain/vegetation.ts`）、
  鉱石（`domain/ore.ts`）、Overworld の要塞（stronghold）のサイト決定と 13×13 石室生成
  （`domain/structure-siting.ts`、`domain/stronghold.ts`）、
  **渓谷カーバー（`domain/ravine.ts`）** — 2 層の水ガードごと。
  帯幅 `RAVINE_HALF_WIDTH` は参照実装から転記する前に実測している
  （帯幅は分布についての主張なので可搬ではない。[docs/responsibility.md](./docs/responsibility.md) §1-6）
- ✅ **自然構造プランとチャンク適用は実装済み** — `domain/natural-structure.ts` が desert pyramid、igloo、jungle pyramid、mineshaft、ocean ruin、ocean monument、pillager outpost、shipwreck、村、ruined Nether portal、
  Nether fortress、bastion remnant、
  End city / ship をリージョン単位で決定し、地形適合を検査して immutable なブロック配置と
  semantic marker をチャンク別に投影する。村は Overworld chunk generator と同じレイアウトを使い、
  Overworld / Nether / End generator は構造ブロックを書き込んで marker の由来を保持する。
  bastion remnant は現行 `mc-kernel` の登録ブロックだけで構成した compact structure であり、vanilla の template / palette parity は主張しない。
  `domain/end-features.ts` は決定論的なスパイク、オブシディアン柱、クリスタル／ケージの意味情報を
  同じ境界投影モデルで提供し、`domain/end-gateway.ts` は bedrock shell と出口設定を純粋な値として公開する。
- **実装済み**: ワーカープール Port の型（`TerrainWorkerPoolPort`）と
  `ChunkSource` adapter。実際の Worker/Pool 媒体はホストが注入する。
  チャンク永続化は `PersistentChunkStoreLayer`、チャンクフォーマット定義は
  `domain/chunk-format.ts` として実装済み。媒体への接続は `mc-save` 側の責務。
  内訳と根拠は [docs/responsibility.md](./docs/responsibility.md) §1-1
- **Nether 地形**: `generateNetherChunk` が決定論的な 3D 洞窟、上下の岩盤、溶岩海、
  ソウルサンドを生成し、ruined portal を適用する
- **End 地形**: `generateEndChunk` が中央島、虚空リング、シード依存の外縁島を生成し、
  End city / ship とスパイクを適用する。クリスタルとケージは entity の副作用を持たない marker として
  保存し、gateway の配置・移動・出口解決は `end-gateway.ts` に分離している
- **バイオーム分類は 6 入力版。** continentalness / erosion / pv / riverNoise を含む
  6 入力で 13 バイオームを分類する（2 入力分類器も保持）
- **公開レジストリへの publish は未実施。** 配布ビルドは `pnpm build` で生成できるが、
  GitHub Packages への認証・公開手順はリリース作業として別途管理する
- **カバレッジは 100% ゲート。** `vitest.config.ts` の 4 指標を `pnpm test:coverage` が検証する

### プレビューが暴いたもの

プレビューを入れた目的は絵ではない。**絵を見て初めて分かることを見ること**である。
実際に 5 件出た。うち F-1 / F-2 は修正済みで、回帰テストが付いている。
どちらも**生成される地形が全ワールドで変わる**変更なので
[docs/versioning.md §6](./docs/versioning.md) の major 扱いである。
全文は [docs/testing.md §4-b](./docs/testing.md)。

| | 内容 |
| --- | --- |
| F-1 ✅ | **世界の 20% が平らにクランプされていた。** `CONTINENTALNESS_CONTRAST = 2.6` を正当化しているコメントの実測値（生の連続性が `[0.40, 0.72]`）が間違っていた。実測は `[0.053, 0.946]` — 窓が地形 4 個分しか無かった。**1.15 に変更**し、flat-clamped 20.0% → 0.01%、海面下 47.5% → 42.9%。回帰テストは `test/terrain-distribution.test.ts` |
| F-2 ✅ | **樹冠が融合していた。** 1 チャンク・1 Y の LEAVES 連結成分が最大 78 ブロック（樹冠 1 個は 21）。`domain/tree-placement.ts` の「格子ジッターは最小間隔を構成的に抑える」は**偽**だった — 抑えるのは密度である。ジッターをセル内の窓に閉じ込めて `TREE_MIN_SPACING = 6 >= 2r + 2` を構成的に保証し、最大連結成分は 20（＝樹冠ちょうど 1 個）。回帰テストは `test/tree-canopy.test.ts`（**生成ブロックで**測る） |
| F-3 | カーバーの水域床ガードは**常時働いている**（稀な境界事例ではない）。ただし `WATER_FLOOR_MARGIN=3` は水底ブロック込みで 3 枚なので、砂 3 枚の下がすぐ洞窟という海底が延々と続く |
| F-4 | デフォルトシードの原点付近ではガードの出番が無い。`g` を押して何も起きないことをもって「無意味」と結論しないこと |
| F-5 | **走査窓が狭いと統計は嘘をつく。** このプレビュー自身が最初にそれをやり、「DESERT と SNOW は到達不能」という誤結論を出した（広げたら 8 バイオーム全部出た）。完成条件 7 の統計テストを書く人への警告 |

## License

MIT
