# テストと完了条件

## 1. コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）と `tsconfig.test.json`（テスト+ツール）の両方 |
| `pnpm lint` | oxlint。このリポジトリ唯一の lint/format 設定（prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 66 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API） |
| `pnpm test:coverage` | カバレッジ計測。**閾値は未設定**（後述） |
| `pnpm verify` | 上記 4 つ（coverage 以外）。CI と同一内容 |

`pnpm` は PATH に無い場合がある。`corepack pnpm <cmd>` で 9.15.0 が起動する。

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
| バイオーム分布の統計テスト | ⬜ 未実装 |
| 内蔵地形プレビュー | ⬜ **未実装** |

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

### 地形プレビューについて

plan.md §2.3-4:「プレビューは検証対象と同居する」。
`apps/preview-terrain/` に置く（plan.md §4.1 の配置規約）。

**mc-playground-kit は使えない。** kit は mc-worldgen に依存しているので、
使うと循環する。プレビューは自前で組む。

プレビューで確認すべきこと:

1. シードを入力して地形を生成し、フライカメラで飛び回れる
2. バイオームを可視化できる（色分け）
3. **海面が 63 であることが目で分かる** — 水位の高さが正しいか
4. **湖底に穴が空いていない** — 洞窟が水域の下を通っている場所を探して覗く
5. 木が板になっていない — 森を上から見て、樹冠が融合していないか
6. チャンク境界に継ぎ目が無い

3 と 4 は DN-1 / DN-2 の目視版である。

## 4. 完了条件

このリポジトリが「完成」と言えるのは以下が全て満たされたときである。

1. `pnpm verify` が green
2. **地形プレビューが操作可能**（上記 6 点を目視確認できる）
   — plan.md §6 Step 2:「worldgen の地形プレビューが最初の遊べる成果物」
3. **シード固定ゴールデンハッシュがコミットされている**
4. **ワーカープールのパリティテストが green**
   — Worker の出力がメインスレッドとバイト一致すること。
   参照実装の `terrain-worker-pool.parity.property.test.ts`（124 LOC）の移植
5. カーバー（洞窟 + 渓谷）・植生・鉱石・構造物・ライトグリッド・`ChunkManager` が実装済み
6. `mc-noise` / `mc-save` / `mc-kernel` への実依存に切り替わっている
   （現在の `domain/seeded-random.ts` `domain/chunk.ts` `domain/biome.ts` の `BLOCK` は仮置き）
7. バイオーム分布の統計テストが green
8. カバレッジ 99% ゲートが有効化されている（後述）

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
