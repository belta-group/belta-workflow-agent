# 付録: Notion REST API を直接叩く場合の JSON（例外的ケース）

**原則として claude.ai Connector MCP（SQL DDL）を使う**。この付録は、Connector MCP が使えず `gh api` / `curl` 等で Notion REST API（`POST /v1/databases`）を**直接**呼ぶ例外ケース専用。通常のスキーマ定義は [notion-property-reference.md](notion-property-reference.md) を参照。

REST API ではプロパティ定義は SQL DDL ではなく JSON オブジェクトになる。主要型の対応：

| 型 | REST API JSON（properties 内の値） |
| --- | --- |
| title | `{ "title": {} }` |
| rich_text | `{ "rich_text": {} }` |
| select | `{ "select": { "options": [ { "name": "高", "color": "red" } ] } }` |
| multi_select | `{ "multi_select": { "options": [ ... ] } }` |
| status | `{ "status": {} }` |
| date | `{ "date": {} }` |
| people | `{ "people": {} }` |
| number | `{ "number": { "format": "dollar" } }` |
| checkbox | `{ "checkbox": {} }` |
| relation | `{ "relation": { "database_id": "<id>", "type": "dual_property", "dual_property": {} } }` |
| formula | `{ "formula": { "expression": "..." } }` |
| rollup | `{ "rollup": { "relation_property_name": "...", "rollup_property_name": "...", "function": "sum" } }` |

> REST API ではページのプロパティ**値**も型ごとの入れ子 JSON（`{"title":[{"text":{"content":"..."}}]}` 等）になる。Connector MCP の `create-pages`（フラットな name→値マップ）とは形式が異なる点に注意。
