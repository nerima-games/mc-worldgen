# mc-worldgen ドキュメント

`@nerima-games/mc-worldgen` を実装するために必要な情報をここに集約している。
**plan.md を読み直さなくても実装できる**ことを目標に書いてある。

---

## 表記

| 表記 | 意味 |
| --- | --- |
| `<reference-impl>` | **参照実装のチェックアウトのルート**。凍結された `takeokunn/ts-minecraft` の作業コピーを指す。本ドキュメント群では `<reference-impl>/packages/…` の形か、単に `packages/…`（同じくルート相対）で引用する。手元のどこに clone してあっても読み替えられるようにするためのプレースホルダである |
| plan.md | リポジトリ構成仕様書（16 リポジトリ、確定済み）。**非公開**であり、公開読者は開けない。だから本ドキュメント群は「plan.md を読まなくても追える」ことを要件にしている —— plan.md の主張を引くときは必ず原文を引用し、参照実装での裏づけを file:line で添える |
| `nerima-games/<repo>` | 同 org の兄弟リポジトリ。リンクは GitHub の URL で張る |

## ⚠ 最初に: plan.md §3.7 の地形定数は**両方とも誤りである**

plan.md §3.7 の 設計注意(参照実装の実測知見) には、こう書いてある:

> 地形定数: `SEA_LEVEL=48`、`LAKE_LEVEL=62`

**両方とも間違っている。** 参照実装 `packages/core/domain/constants.ts` の実物:

```
:16  // Phase 2.1 MC 1.18-aligned. Ocean biome water fills up to this height.
:17  export const SEA_LEVEL = 63
:19  // Phase 2.1 MC 1.18-aligned. Inland lake water surface matches sea level.
:20  export const LAKE_LEVEL = SEA_LEVEL
```

| | plan.md §3.7 | 実物 |
| --- | --- | --- |
| `SEA_LEVEL` | 48 | **63** |
| `LAKE_LEVEL` | 62 | **63**。しかも独立した定数ではなく `SEA_LEVEL` そのもの |

### なぜこれが特に危険なのか

plan.md §3.7 のこの項目は
**「設計注意(参照実装の実測知見)」— 回帰テスト化せよと指示されているセクション**に載っている。

つまり plan.md を素直に読んだ実装者は、
`expect(SEA_LEVEL).toBe(48)` というテストを書く。
そのテストが green になった瞬間、誤りが「検証済みの仕様」に昇格して固定される。

さらに `LAKE_LEVEL` を 62、`SEA_LEVEL` を 48 とすると
**湖面が海面より 14 ブロック高い**という、参照実装に一度も存在しなかった
世界観が生まれる。湖と海の間に段差を作る分岐コードが書かれ、
その分岐は誰も要求していないものになる。

正しい理解は「**湖面と海面は同一である。両者を区別する定数は存在しない**」である。

固定しているテスト: `test/terrain-levels.test.ts`
（`SEA_LEVEL is 63 — NOT the 48 that plan.md §3.7 states` ほか）。
詳細は [design-notes.md](./design-notes.md#dn-1)。

---

## 読む順序

| ファイル | 内容 |
| --- | --- |
| [architecture.md](./architecture.md) | 4 階層アーキテクチャ、16 リポジトリ依存グラフ、mc-worldgen の位置 |
| [responsibility.md](./responsibility.md) | 責務と**非スコープ**、親・子リポジトリ |
| [public-api.md](./public-api.md) | 公開すべき API。参照実装の実コードで検証済み |
| [design-notes.md](./design-notes.md) | 設計注意。参照実装の証拠 (file:line) 付き、回帰テスト名として提示 |
| [porting.md](./porting.md) | 移植元パスと**実測 LOC** |
| [testing.md](./testing.md) | 検証要件・完了条件・カバレッジゲートの扱い |
| [versioning.md](./versioning.md) | 0.x → 1.0.0 の方針、GitHub Packages、publish の開始時期 |

## その他に知っておくべき 3 点

### 1. カーバーの「水域の床マージン検査」は**参照実装で既に修正済み**である

plan.md §3.7 はこれを「参照実装の重大バグ」と書いているが、
実際には修正され、回帰テストまで付いている
（`packages/world/domain/terrain/cave-carver.ts:70-74`、
`packages/world/test/cave-carver.test.ts:201`）。

**避けるべきバグではなく、移植すべき修正である。**
しかも修正には微妙な後半部分があり、
「biome が OCEAN か RIVER か」で判定するだけでは不十分だった。
詳細は [design-notes.md](./design-notes.md#dn-2)。

### 2. `packages/world` は THREE.js を 0 回しか import していない（実測確認済み）

この分離があるから世界生成は Worker でも Node でも canvas 無しのテストでも走る。
mc-worldgen では `tsconfig.base.json` の `lib` に `"DOM"` を入れないことで
**機械的に不可能**にしてある。詳細は [design-notes.md](./design-notes.md#dn-3)。

### 3. `SEA_LEVEL` / `LAKE_LEVEL` は参照実装でも**注入されていた**

`packages/world` 内でこの定数を import している箇所は**たった 1 つ**
（`domain/terrain/generator-types.ts:3`）で、そこで `DEFAULT_TERRAIN_LEVELS` になり、
以降は `terrainLevels: TerrainLevels = DEFAULT_TERRAIN_LEVELS` として引数で流れていた。

この設計は良いのでそのまま維持する。→ [public-api.md](./public-api.md#levels)

## 現在の状態

監査済みの実装状況。要塞石室・ライトグリッド・`ChunkStore` は実装済み。
村・ruined Nether portal・End city / ship は決定論的な自然構造プラン、地形適合検査、
semantic marker、チャンク別投影まで実装済み。Nether / End chunk generator への適用とチャンク永続化は未実装。
End の基礎地形（中央島・虚空リング・外縁島）は実装済み
（[testing.md](./testing.md)）。
