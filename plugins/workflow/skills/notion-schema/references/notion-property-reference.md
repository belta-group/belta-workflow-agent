# Notion プロパティ・リファレンス（claude.ai Connector 版 MCP）

LLM が `notion-create-database` / `notion-update-data-source` / `notion-create-pages` の呼び出しに**直接転用できる粒度**の型リファレンス。

> **重要**: 接続中の Notion MCP（claude.ai Connector）は、従来の Notion REST API の JSON プロパティ定義（`{"type":"title","title":{}}` 形式）**ではなく、SQL DDL 構文**でスキーマを定義する。本リファレンスは実ツールに準拠する。REST API を直接叩く例外ケース（`gh`/`curl` 経由）の JSON 形式は [notion-rest-api-appendix.md](notion-rest-api-appendix.md) を参照（Connector MCP が使える限り不要）。

スキーマ定義（プロパティの**型**）は DDL、レコード（ページ）の**値**は `create-pages` の JSON マップ、と層が分かれる。両方を型ごとに示す。

---

## 1. スキーマ定義の構文（create-database / update-data-source）

### 共通ルール

- 列（プロパティ）名は **ダブルクォート** `"タスク名"`、型のオプション値は **シングルクォート** `'高'`。
- `create-database` は `schema` に 1 つの `CREATE TABLE (...)` 文。
- `update-data-source` は `statements` にセミコロン区切りの `ADD/DROP/RENAME/ALTER COLUMN` 文。
- title プロパティを省略すると `Name` が自動追加される。1 DB に title は 1 つ。
- 任意の列に `COMMENT '説明文'` を付けられる。

### 色（SELECT / MULTI_SELECT / STATUS の選択肢）

`default`, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`

---

## 2. 型別リファレンス

各型について「DDL 型構文」と「`create-pages` での値（JSON）」を併記する。`create-pages` の `properties` は `{ "プロパティ名": 値 }` のマップで、値は文字列 / 数値 / null のいずれか（SQLite 値）。一部の型は展開形式が必要なため、迷ったら対象 DB を `notion-fetch` し、返却の `<database>` 内 SQLite 定義に従う。

### title（タイトル）

- **DDL**: `"タスク名" TITLE`
- **値（create-pages）**: 文字列（インライン Markdown 可）。例 `"タスク名": "請求書テンプレート改訂"`
- 1 DB に必ず 1 つ。省略時 `Name` が自動生成。

### rich_text（リッチテキスト / 自由記述）

- **DDL**: `"メモ" RICH_TEXT`
- **値**: 文字列。例 `"メモ": "金額欄の書式を見直す"`
- 長文・本文には使わない（ページ本文に置く）。短い注記・要約向け。

### select（単一選択）

- **DDL**: `"優先度" SELECT('高':red, '中':yellow, '低':green)`
- **値**: 選択肢名の文字列。例 `"優先度": "高"`
- 取りうる値が有限なものは必ずこれ（テキストにしない）。

### multi_select（複数選択）

- **DDL**: `"タグ" MULTI_SELECT('開発':blue, '運用':orange, '調査':purple)`
- **値**: 選択肢名（複数はカンマ区切り文字列。確実を期すなら `notion-fetch` の `<database>` 定義に従う）。例 `"タグ": "開発,運用"`

### status（ステータス）

- **DDL**: `"ステータス" STATUS`
- **値**: ステータス名の文字列。例 `"ステータス": "進行中"`
- 状態遷移（未着手→進行中→完了）を表す進捗管理に使う。Board View の軸。SELECT と違いグループ（To-do / In progress / Complete）を持つ。

### date（日付）

- **DDL**: `"期日" DATE`
- **値**: ISO 8601 文字列。例 `"期日": "2026-06-14"`（日時は `"2026-06-14T15:00:00+09:00"`）

### people（ユーザー）

- **DDL**: `"担当者" PEOPLE`
- **値**: Notion ユーザー。`notion-get-users` で取得した ID を用いる（展開形式が必要な場合あり。`notion-fetch` の定義に従う）。
- 氏名のテキスト直書きは不可。必ず Notion ユーザーに紐付ける。

### checkbox / url / email / phone_number / files

- **DDL**: `"確認済" CHECKBOX`, `"リンク" URL`, `"連絡先" EMAIL`, `"電話" PHONE_NUMBER`, `"添付" FILES`
- **値**: checkbox は真偽（`1`/`0` または `true`/`false`、定義に従う）、url/email/phone は文字列、files は展開形式。

### number（数値）

- **DDL**: `"工数" NUMBER`、書式付き `"予算" NUMBER FORMAT 'dollar'`
- **値**: 数値。例 `"工数": 8`
- 集計（rollup / formula）対象は必ず NUMBER。

### unique_id（自動採番 ID）

- **DDL**: `"タスク ID" UNIQUE_ID PREFIX 'TASK'`
- **値**: 自動採番のため `create-pages` では指定しない。
- 口頭・Slack で参照しやすい人間可読 ID（`TASK-12` 等）。

### created_time / last_edited_time（自動タイムスタンプ）

- **DDL**: `"作成日時" CREATED_TIME`, `"更新日時" LAST_EDITED_TIME`
- **値**: 自動設定のため指定しない。

---

## 3. relation（リレーション）

DB 間（または自己）の参照。**参照先データソース ID（`ds_id`）が必須**。relation を張る前に相手 DB を `notion-fetch` し、返却の `<data-source>` タグの ID（`collection://<id>` または素の UUID）を得る。

| 形 | DDL | 用途 |
| --- | --- | --- |
| 一方向 | `"プロジェクト" RELATION('<ds_id>')` | 片側からのみ辿る |
| 双方向 | `"プロジェクト" RELATION('<ds_id>', DUAL)` | 両 DB から辿る（逆側プロパティ自動生成） |
| 双方向 + 逆名指定 | `"プロジェクト" RELATION('<ds_id>', DUAL 'タスク')` | 逆側プロパティ名を「タスク」にする |
| 双方向 + 逆名 + 逆 ID | `RELATION('<ds_id>', DUAL '<synced_name>' '<synced_id>')` | 自己参照で名前と ID 両方を明示 |

- **値（create-pages）**: 紐付け先ページの ID。展開形式が必要なため、`notion-fetch` の定義と `notion-search` で取得した相手ページ ID を用いる。
- **自己参照（self-relation）** は 2 段階：
  1. relation 列なしで `create-database` → DB 作成。
  2. `notion-fetch` で自身のデータソース ID を取得。
  3. `update-data-source` で双方向の self-relation を 1 文で追加：
     ```sql
     ADD COLUMN "親" RELATION('<self_ds_id>', DUAL '子' 'children');
     ADD COLUMN "子" RELATION('<self_ds_id>', DUAL '親' 'parent')
     ```

---

## 4. formula（数式）

- **DDL**: `"残日数" FORMULA('式')`
  - 例: `"残日数" FORMULA('dateBetween(prop("期日"), now(), "days")')`
- 他プロパティから計算した値を表示する（保存はされない、表示時計算）。
- 重い relation rollup の代わりに、軽い派生値はこちらで済むことがある。
- 式構文は Notion の formula 言語に従う（`prop("名前")`, `now()`, `dateBetween`, `if`, 算術・比較演算子等）。

---

## 5. rollup（ロールアップ）

relation 先の値を集計する。

- **DDL**: `"未完タスク数" ROLLUP('<rel_prop>', '<target_prop>', '<function>')`
  - `<rel_prop>`: この DB の relation プロパティ名（例 `'タスク'`）
  - `<target_prop>`: relation 先 DB のプロパティ名（例 `'ステータス'`）
  - `<function>`: 集計関数（`count`, `count_values`, `sum`, `average`, `min`, `max`, `earliest_date`, `latest_date`, `percent_checked` 等）
  - 例: `"合計工数" ROLLUP('タスク', '工数', 'sum')`
- **値**: 自動計算のため `create-pages` では指定しない。
- **性能注意**: 参照先が 100 件超の relation に rollup を多用すると重い。高頻度指標に限定する（[best-practices.md](best-practices.md) §3）。

---

## 6. 組み合わせ例（Tasks DB 最小形）

```json
{
  "title": "Tasks",
  "schema": "CREATE TABLE (\"タスク名\" TITLE, \"ステータス\" STATUS, \"担当者\" PEOPLE, \"期日\" DATE, \"優先度\" SELECT('高':red, '中':yellow, '低':green), \"タスク ID\" UNIQUE_ID PREFIX 'TASK')"
}
```

レコード作成（`create-pages`）：

```json
{
  "parent": { "type": "data_source_id", "data_source_id": "<tasks_ds_id>" },
  "pages": [
    {
      "properties": {
        "タスク名": "請求書テンプレート改訂",
        "ステータス": "進行中",
        "期日": "2026-06-14",
        "優先度": "高"
      }
    }
  ]
}
```

---

> `gh api` / `curl` 等で Notion REST API を**直接**叩く例外ケースの JSON 形式（`{"select":{"options":[...]}}` 等）は [notion-rest-api-appendix.md](notion-rest-api-appendix.md) に分離。**原則として Connector MCP（本リファレンスの DDL）を使い、付録は最終手段**。
