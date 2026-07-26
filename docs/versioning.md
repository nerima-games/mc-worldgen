# バージョニングと公開

## 1. 現在: `0.1.0`、未公開

`package.json`:

```json
"version": "0.1.0",
"publishConfig": { "registry": "https://npm.pkg.github.com", "access": "restricted" }
```

`publishConfig` は書いてあるが、**publish はまだ一度も行っていない**。

## 2. なぜまだ公開しないのか

plan.md §6 Step 0 / §8:

> npm 公開・バージョン bump 運用は**界面安定（4 週間 API ロック無変更）まで開始しない**
>
> リスク「新規構築初期は全界面が高 churn」→ 対策「npm 公開を遅らせ dev-meta workspace で開発。
> bump 連鎖を構造的に回避」

16 リポジトリが互いに依存している状態で早期に publish を始めると、
kernel の些細な変更が 15 リポジトリの version bump を誘発する。
開発初期は界面が動くのが当たり前なので、これは毎日起きる。

代わりに `mc-dev-meta` workspace で `workspace:*` 解決を使い、
モノレポと同等の DX で開発する。

### 現時点で `dependencies` に `effect` しか無い理由

スケルトン段階では**兄弟リポジトリへの依存を意図的に持たない**。

mc-worldgen はホワイトリスト上 `mc-noise` と `mc-save`（および普遍的な `mc-kernel`）を
import してよいが、`package.json` にはどれも入っていない。理由:

- 何も publish されていないので `@nerima-games/*` はどれも解決できない
- スケルトンには import すべき兄弟のコードがまだ無い

そのため以下は**仮置き**であり、依存が消費可能になった時点で削除する:

| 仮置き | 本来の所属 |
| --- | --- |
| `domain/seeded-random.ts` | `mc-noise` |
| `domain/chunk.ts` の `Chunk` 型 | `mc-kernel` |
| `domain/biome.ts` の `BLOCK` テーブル | `mc-kernel` |
| チャンクフォーマット定義（未実装） | 定義は worldgen、機構は `mc-save` |

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

1. `mc-sim` がチャンクを読み、ダーティ通知を受けている
2. `mc-render` がダーティ購読からメッシュを更新している
3. その状態で API を 4 週間変更していない（plan.md §6 Step 3 の API ロック条件）
4. 地形プレビューが操作可能である（plan.md §6 Step 2 の完了条件）
5. `mc-noise` / `mc-save` / `mc-kernel` への実依存に切り替わっている

**mc-worldgen には 5 つの下流がある**（sim / render / playground-kit / gameplay / redstone）。
mc-sim ほどではないが依存ハブなので、界面が動くと 5 箇所に波及する。

「良さそうだから 1.0 にする」はしない。

## 5. ビルドと publish のパイプライン

### 現状: ビルドステップが無い

`package.json`:

```json
"main": "./index.ts",
"types": "./index.ts",
"exports": { ".": "./index.ts" }
```

**TypeScript ソースを直接指している。** `tsconfig.base.json` の `noEmit: true` も同じ理由である。

これは `mc-dev-meta` workspace 内でのみ成立する構成である
（consumer 側がソースをコンパイルする）。

### 完成時に追加するもの

1. `tsconfig.build.json` の `noEmit` を外し、`dist/` に emit する
2. `exports` を `dist/index.js` + `dist/index.d.ts` に向ける
3. `files` から `domain` を外し `dist` を入れる
4. CI に `pnpm build` と、tag push での `pnpm publish` を追加
5. `.npmrc` に GitHub Packages の認証設定（`//npm.pkg.github.com/:_authToken=`）を追加

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
