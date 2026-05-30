# パターン 3: Knowledge（ナレッジ・手順書・社内 wiki）

再利用する知識を鮮度・機密度管理つきで蓄積する DB。型構文・色・JSON 値の具体は [../notion-property-reference.md](../notion-property-reference.md)、全パターン共通の設計原則は [../best-practices.md](../best-practices.md) を参照。

DDL 例は claude.ai Connector 版 Notion MCP（`notion-create-database` の `schema`）にそのまま転用できる。**プロパティ名は日本語可、DB 名は英語**。

## いつ使う

- 手順書・FAQ・設計メモなど再利用する知識を蓄積する
- 鮮度管理（最終レビュー日）と機密度管理が必要なドキュメント
- 部署横断で参照されるリファレンス

## DB 名

`Knowledge Base`

## プロパティ表

| プロパティ名 | 型 | 必須 | 備考 |
| --- | --- | --- | --- |
| タイトル | `TITLE` | ○ | |
| カテゴリ | `SELECT` | ○ | 手順 / FAQ / 設計 / ポリシー |
| 管理者 | `PEOPLE` | ○ | オーナー（更新責任者） |
| 最終レビュー | `DATE` | ○ | 鮮度管理。古いものを洗い出す軸 |
| 関連ドキュメント | `RELATION` → Knowledge Base（自己参照） | | 関連知識を相互リンク |
| 機密度 | `SELECT` | ○ | 公開 / 社外秘 / 極秘（profile.md と整合） |
| タグ | `MULTI_SELECT` | | 検索性向上 |

## DDL 例

```sql
CREATE TABLE (
  "タイトル" TITLE,
  "カテゴリ" SELECT('手順':blue, 'FAQ':green, '設計':purple, 'ポリシー':red),
  "管理者" PEOPLE,
  "最終レビュー" DATE,
  "機密度" SELECT('公開':green, '社外秘':orange, '極秘':red),
  "タグ" MULTI_SELECT('情シス':blue, '営業':orange, '開発':purple)
)
```

> 「関連ドキュメント」は**自己参照 relation**。作成時には自身のデータソース ID が未確定なので、まず上記で DB を作成 → `notion-fetch` で自身のデータソース ID を取得 → `update-data-source` で `ADD COLUMN "関連ドキュメント" RELATION('<self_ds_id>', DUAL '関連元' 'related_from')` のように 2 段階で張る（self-relation の synced 指定は [../notion-property-reference.md](../notion-property-reference.md) の relation 節を参照）。

## 関連 DB

- **Knowledge Base 自身**（自己参照）: 関連知識の相互リンク。
- 必要に応じて **Projects / Tasks**: どの取り組みで生まれた知識か（[tasks.md](tasks.md)）。

## このパターン固有のアンチパターン

- 機密度プロパティを持たせない → 極秘ドキュメントが公開 View に混ざる。`SELECT` で必須化し、PII フックと多重防御。
- 最終レビュー日を持たない → 陳腐化した手順が放置される。`DATE` を必須にしフィルタ View で棚卸し。
- カテゴリを `RICH_TEXT` にする → 表記揺れで分類不能。`SELECT` に正規化。
