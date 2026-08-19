# バージョニングと公開

## 1. 現在: `0.1.14`、未公開

`package.json`:

```json
"version": "0.1.14"
```

`publishConfig` は書いてあるが、**publish はまだ一度も行っていない**。

## 2. なぜまだ公開しないのか

plan.md §6 Step 0 / §8:

> npm 公開・バージョン bump 運用は**界面が安定したと maintainer が判断するまで開始しない**
> （RELEASE_STANDARD.md §4.2: 1.0.0 昇格は日数計測ベースの自動ゲートではなく、
> maintainer の裁量判断による）
>
> リスク「新規構築初期は全界面が高 churn」→ 対策「npm 公開を遅らせ dev-meta workspace で開発。
> bump 連鎖を構造的に回避」

16 リポジトリが互いに依存している状態で早期に publish を始めると、
kernel の些細な変更が 15 リポジトリの version bump を誘発する。
開発初期は界面が動くのが当たり前なので、これは毎日起きる。

現在の checkout は単独パッケージとして、`package.json` に解決可能なバージョン付きの
`mc-kernel` / `mc-noise` / `mc-save` を宣言している。依存先の実装をこのリポジトリへ
複製せず、公開パッケージの API を直接利用する。

mc-worldgen のドメインコードは、次の責務境界で各パッケージを直接消費する:

| このリポジトリの責務 | 直接利用する契約 |
| --- | --- |
| `(seed, coordinate)` による地形・装飾の生成 | `mc-noise` |
| ブロック ID とチャンク座標 | `mc-kernel` |
| 永続化用の型・エンコード契約 | `mc-save` |
| 生成中の可変ブロック・バイオーム配列 | worldgen 固有の書き込みバッファ `Chunk` |

保存フォーマットの最小入力を読むコードは、永続化フォーマットの契約として残している。
これはローカルの旧 API 用互換層ではない。

意図された依存グラフは**コードとドキュメントの側に**記録してある:

- `scripts/check-dependency-whitelist.ts` の `REPOSITORY_POLICY.dependencyGraph`（16 行全部）
- [architecture.md](./architecture.md) の Mermaid 図

publish 開始時に、ボトムアップ（kernel → 各 tier1 → worldgen → …）で
**publish してから pin する**。

## 3. `0.x` の間の約束

| 項目 | 方針 |
| --- | --- |
| semver | `0.x` なので minor bump で破壊的変更が入りうる |
| 破壊的変更の扱い | CHANGELOG に必ず書く。黙って変えない |
| 消費者 | まだ居ない。居ないうちに界面を固める |

## 4. `1.0.0` にする条件

**下流リポジトリが実際に消費して契約を確認したとき**に `1.0.0` にする。

mc-worldgen の場合、具体的には:

1. `mc-sim` が `ChunkStore` からチャンクを読んでいる
2. `mc-render` が `ChunkStore.subscribeDirty` の購読からメッシュを更新している
   （ダーティ通知はこのリポジトリが所有する。plan.md §3.8 は mc-sim の API と
   しているが、フラグを持つのは §3.7 によりここであり、sim 経由にすると毎フレーム
   全チャンクのポーリングになる。根拠は [public-api.md](./public-api.md) §6-2）
3. 上記の消費・動作確認が完了したと maintainer が判断している
   （日数計測ベースの自動ゲートは廃止。RELEASE_STANDARD.md §4.2 参照）
4. 地形プレビューが操作可能である（plan.md §6 Step 2 の完了条件）
5. `mc-noise` / `mc-save` / `mc-kernel` の実依存を下流で消費し、契約を確認している

**mc-worldgen には 5 つの下流がある**（sim / render / playground-kit / gameplay / redstone）。
mc-sim ほどではないが依存ハブなので、界面が動くと 5 箇所に波及する。

「良さそうだから 1.0 にする」はしない。

## 5. ビルドと publish のパイプライン

### 現状: ローカル配布ビルドは実装済み、publish は未実施

`package.json`:

```json
"main": "./dist/index.js",
"types": "./dist/index.d.ts",
"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }
```

`pnpm build` は `esbuild` で ESM をバンドルし、`tsconfig.package.json` で宣言ファイルを
`dist/` に出力する。リポジトリの型検査プロジェクトは引き続き `noEmit: true` である。

`files` は `dist/` とドキュメントだけを含むため、consumer は TypeScript ソースを直接コンパイルしない。
公開レジストリへの publish はまだ実施していない。

### リリース時に確認するもの

1. `pnpm verify` を通し、`dist/index.js` と `dist/index.d.ts` を生成する
2. `node --input-type=module` で `dist/index.js` を consumer と同じ ESM エントリとして読み込む
3. `pnpm pack --dry-run` で `dist/`、ドキュメント、`LICENSE`、`package.json` が含まれ、`src/` と `test/` が含まれないことを確認する
4. CI に `pnpm build` と、tag push での `pnpm publish` を追加する
5. GitHub Packages の認証を secret 経由で設定する

### `.npmrc` の現状

今入っているのは publish 設定ではなく、**依存解決の回避策**である:

```
public-hoist-pattern[]=fast-check
public-hoist-pattern[]=pure-rand
```

`fast-check` は `effect` の推移的依存（`effect/FastCheck` の re-export 経由）だが
pnpm が既定で hoist しないため、`tsc` が型を解決できない。
`pure-rand` は `fast-check` の実行時依存で、Vite が
フラットな `node_modules/fast-check` から解決できるように並べて hoist している。

## 6. 地形の変更は semver では表現しきれない

**最も注意すべき点である。**

セーブファイルは地形ではなく**シードを保存する**。
つまり生成アルゴリズムを変更すると、既存の全ワールドの未ロード領域が変わる。
プレイヤーが探索していた先に、昨日と違う地形が現れる。

| 変更 | 見かけの semver | 実際の影響 |
| --- | --- | --- |
| ノイズ関数の差し替え | patch に見える | **全ワールドの地形が変わる** |
| `SEA_LEVEL` の変更 | patch に見える | **全ワールドの海岸線が変わる** |
| カーバーの閾値調整 | patch に見える | **既にロード済みの領域と未ロード領域で洞窟が食い違う** |
| バイオーム分類ルールの追加 | minor に見える | **バイオーム境界が動く** |
| 木の配置定数の変更 | patch に見える | 森の見た目が変わる |
| **地形シェイパーの定数の変更** | patch に見える | **全ワールドの高度場が変わる**（下記の実例） |

### 実例: この分類が実際に適用された 2 件

docs/testing.md §4-b の F-1 と F-2 の修正は、**上の表の 2 行を同時に踏んでいる**。
`0.x` なので minor bump に収まるが、**運用 1 のとおり major 扱い**である。

| 定数 | before | after | 帰結 |
| --- | ---: | ---: | --- |
| `CONTINENTALNESS_CONTRAST` | 2.6 | 1.15 | 全シードの全列で高度が変わる。海岸線・バイオーム境界・洞窟の露出が全部動く |
| `TREE_GRID_SIZE` | 4 | 8 | 木が全部別の場所に生える |
| `TREE_CELL_JITTER_SPAN` | （無し） | 3 | 同上 |
| `BIOME_TREE_DENSITY.FOREST` | 0.04 | 0.012 | 森の密度が 1/3 |
| `BIOME_TREE_DENSITY.TAIGA` | 0.03 | 0.009 | 同上 |

**セーブファイルが 1 つでも存在していたら、この 5 行は全部それを壊していた。**
今はまだ消費者が居ないので払わずに済んでいるだけである
（§4「`1.0.0` にする条件」がまさにこれを言っている）。

なぜこの 5 つが動いたことに気づけるか:

1. `api-lock.md` に**リテラル型として現れる**。`const CONTINENTALNESS_CONTRAST = 2.6`
   が `= 1.15` になるのは、`pnpm api:check`（= `pnpm verify`）が落ちる差分である。
   数値定数を `export const` にしてある副産物であり、狙って残す価値がある性質である
2. `test/terrain-distribution.test.ts` と `test/tree-canopy.test.ts` が
   分布そのものを固定している
3. `scripts/bench-baseline.json` が生成コストの変化を記録している

**ゴールデンハッシュ（完了条件 3）はまだ無い。** あればこの 2 件は
「ハッシュが変わった」という 1 行で表現できたはずである。
今回は分布テストと api-lock がその代役をした。

plan.md §3.2 は mc-noise について同じことを言っている:

> **seed→値のインターフェースは凍結扱い**（変更 = 全ワールドの地形が変わる破壊的変更）

mc-worldgen も同じ扱いにする。

### 運用

1. **生成に影響する変更は全て major 扱い**とする。
   semver 上の型互換性とは無関係である
2. **ゴールデンハッシュの差分をレビューの起点にする**
   （[testing.md](./testing.md) §3）。ハッシュが変わったら地形が変わった
3. **チャンクフォーマットのバージョンを上げる**選択肢がある。
   mc-save の `defineFormat` でチャンクフォーマットを定義するので、
   世代を上げてマイグレーションを書けば「旧世代のチャンクは旧アルゴリズムで再生成」も
   原理的には表現できる。ただし旧アルゴリズムのコードを残す必要があり、コストは高い
4. 参照実装は 3 をやらず、ロード時の場当たり修復で凌いでいた
   （`chunk-manager-ops-storage.ts:54-60` の `healHollowWaterBeds`）。
   名前もバージョンもテストも無い修復である。同じことをしないこと

### `TerrainLevels` が注入である理由の一つでもある

`SEA_LEVEL` を定数として焼き込まず設定型にしてあるので、
「旧ワールドは 63、新ワールドは別の値」という運用が原理的に可能になる。
やるかどうかは別として、選択肢を残す設計にはなっている。
