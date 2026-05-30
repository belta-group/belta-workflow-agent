# パターン 2: Meetings（議事録・会議メモ）

会議の議事録を構造化し、決定事項と次アクションを後から追える DB。型構文・色・JSON 値の具体は [../notion-property-reference.md](../notion-property-reference.md)、全パターン共通の設計原則は [../best-practices.md](../best-practices.md) を参照。

DDL 例は claude.ai Connector 版 Notion MCP（`notion-create-database` の `schema`）にそのまま転用できる。**プロパティ名は日本語可、DB 名は英語**。relation の `ds_id` は相手 DB を `notion-fetch` して得たデータソース ID に置き換える。

## いつ使う

- 定例 / 不定例の会議の議事録を構造化して残す
- 決定事項（Decisions）と次アクション（Action Items）を後から追えるようにする
- 議事録 → タスク化のハブにする

## DB 名

`Meeting Notes`

## プロパティ表

| プロパティ名 | 型 | 必須 | 備考 |
| --- | --- | --- | --- |
| タイトル | `TITLE` | ○ | 「YYYY-MM-DD <会議名>」推奨 |
| 開催日 | `DATE` | ○ | Timeline / カレンダー View の軸 |
| 出席者 | `PEOPLE` | ○ | Notion ユーザー紐付け |
| 種別 | `SELECT` | | 定例 / 臨時 / 1on1 / 外部 |
| 決定事項 | `RICH_TEXT` | | 本文 or 箇条書き。短い要約はここ、詳細はページ本文 |
| Action Items | `RELATION` → Tasks | | 決定 → タスクへ展開（DUAL） |
| 関連プロジェクト | `RELATION` → Projects | | 任意 |

## DDL 例

```sql
CREATE TABLE (
  "タイトル" TITLE,
  "開催日" DATE,
  "出席者" PEOPLE,
  "種別" SELECT('定例':blue, '臨時':orange, '1on1':green, '外部':red),
  "決定事項" RICH_TEXT
)
```

> `Action Items`（→ Tasks）と `関連プロジェクト`（→ Projects）の relation は、それぞれ Tasks / Projects DB のデータソース ID を `notion-fetch` で取得してから `update-data-source` で `ADD COLUMN` する。議事録本文（長文）はプロパティではなく **ページ本文**（`notion-create-pages` の `content`）に置く。

## 関連 DB

- **Tasks**（Meetings → Tasks、一対多）: Action Item をタスクとして起票し、議事録から辿れるようにする（[tasks.md](tasks.md)）。
- **Projects**（任意）: どのプロジェクトの会議か。

## このパターン固有のアンチパターン

- 決定事項・議論内容を全部プロパティに詰める → 横長で読めない。要約のみプロパティ、詳細はページ本文へ。
- Action Item をテキストで書きっぱなしにする → 実行追跡されない。Tasks へ relation で展開する。
- 出席者を `MULTI_SELECT`（名前を選択肢化）にする → 人事異動で破綻。`PEOPLE` を使う。
