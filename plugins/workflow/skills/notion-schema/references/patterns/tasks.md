# パターン 1: Tasks（タスク・TODO・チケット）

タスク・TODO を期日と担当付きで追う DB。型構文・色・JSON 値の具体は [../notion-property-reference.md](../notion-property-reference.md)、全パターン共通の設計原則は [../best-practices.md](../best-practices.md) を参照。

DDL 例は claude.ai Connector 版 Notion MCP（`notion-create-database` の `schema`）にそのまま転用できる。**プロパティ名は日本語可、DB 名は英語**。relation の `ds_id` は相手 DB を `notion-fetch` して得たデータソース ID に置き換える。

## いつ使う

- 個人 / チームのタスク・TODO を期日と担当付きで追う
- プロジェクト配下のチケット管理
- 議事録から切り出した Action Item の受け皿

## DB 名

`Tasks`（プロジェクト単位なら `Tasks - <Project>` ではなく、単一 `Tasks` DB + Project relation を推奨）

## プロパティ表

| プロパティ名 | 型 | 必須 | 備考 |
| --- | --- | --- | --- |
| タスク名 | `TITLE` | ○ | 1 DB に 1 つの title |
| ステータス | `STATUS` | ○ | 未着手 / 進行中 / 完了（自由記述にしない） |
| 担当者 | `PEOPLE` | ○ | Notion ユーザーに紐付け（テキスト名にしない） |
| 期日 | `DATE` | ○ | Timeline View の軸になる |
| 優先度 | `SELECT` | | 高 / 中 / 低 |
| プロジェクト | `RELATION` → Projects | | 1 タスクは 1 プロジェクト（DUAL 推奨） |
| タグ | `MULTI_SELECT` | | 横断ラベル（領域・種別） |
| タスク ID | `UNIQUE_ID PREFIX 'TASK'` | | 口頭・Slack で参照しやすくする |

## DDL 例

```sql
CREATE TABLE (
  "タスク名" TITLE,
  "ステータス" STATUS,
  "担当者" PEOPLE,
  "期日" DATE,
  "優先度" SELECT('高':red, '中':yellow, '低':green),
  "タグ" MULTI_SELECT('開発':blue, '運用':orange, '調査':purple),
  "タスク ID" UNIQUE_ID PREFIX 'TASK'
)
```

> プロジェクトとの relation は、Projects DB を `notion-fetch` してデータソース ID を得てから、`update-data-source` で `ADD COLUMN "プロジェクト" RELATION('<projects_ds_id>', DUAL 'タスク')` のように追加する（作成時に相手 ID が分かっていれば `CREATE TABLE` に直接含めてもよい）。

## 関連 DB

- **Projects**（Tasks → Projects、多対一）: プロジェクト側に「タスク」逆リレーションを DUAL で持たせる。
- **Meetings**（Meetings → Tasks）: 議事録の Action Item をタスク化する経路（[meetings.md](meetings.md)）。

## このパターン固有のアンチパターン

- ステータスを `RICH_TEXT` にする → Board View が作れず集計もできない。必ず `STATUS`。
- 担当者を `RICH_TEXT`（氏名直書き）にする → 表記揺れで絞り込めない。`PEOPLE` を使う。
- プロジェクトごとに別 DB を量産する → 横断集計不能。単一 Tasks + Project relation に正規化。
