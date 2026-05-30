---
name: notion-schema
description: >
  Notion データベース（DB）のスキーマ設計知識。Tasks / Meetings / Knowledge の 3 コア
  パターン、正規化・relation・rollup・View・命名のベストプラクティス、アンチパターン、
  および claude.ai Connector 版 Notion MCP（SQL DDL）への変換リファレンスを保持する。
  「Notion の DB を作りたい」「データベース設計」「プロパティ設計」「議事録 DB」
  「タスク管理 DB」「ナレッジベースを作る」等のスキーマ設計依頼で workflow スキルから委譲される。
---

# Notion スキーマ設計

Notion データベースを **API エラーなく・後から破綻しない構造で** 設計するための知識スキル。`workflow` スキルが「DB / データベース設計・プロパティ設計」と判断したときに委譲される。

利用者は Notion のプロパティ型や relation の仕組みを知らなくてよい。このスキルが要件を聞き取り、適切なパターンを選び、実際の MCP ツール呼び出しに変換する。

## いつ使うか

- Notion の DB / データベース / テーブルを新規作成したいとき
- 既存 DB のプロパティを追加・変更・正規化したいとき
- 議事録・タスク・ナレッジなどを「ちゃんと管理できる形」にしたいと言われたとき
- `workflow` スキルから Notion スキーマ設計として委譲されたとき

---

## 最重要: 接続中の Notion MCP は SQL DDL を使う

claude.ai Connector 経由の Notion MCP は、従来の Notion REST API（`{"type":"title", ...}` 形式の JSON プロパティ定義）**ではなく**、**SQL DDL（`CREATE TABLE` / `ALTER`）構文**でスキーマを定義する。ここを取り違えると tool call が必ず失敗する。

| やりたいこと | 使うツール | 渡し方 |
| --- | --- | --- |
| DB を新規作成 | `notion-create-database` | `schema` に `CREATE TABLE (...)` 文字列 |
| 既存 DB にプロパティ追加・変更 | `notion-update-data-source` | `statements` に `ADD/DROP/RENAME/ALTER COLUMN` 文 |
| DB にレコード（ページ）を作成 | `notion-create-pages` | `properties` に「プロパティ名 → 値」の JSON マップ |
| 既存 DB の構造を読む | `notion-fetch` | DB の URL / ID。返却の `<data-source>` タグに collection ID |

> **データソース（data source）の概念**: Notion の 1 つの DB は 1 つ以上の「データソース（collection）」を内包する。`notion-fetch` の結果に出る `<data-source>` タグの ID（`collection://<id>` または素の UUID）が、`update-data-source` や relation の参照先になる。relation を張る前に、必ず対象 DB を `notion-fetch` してデータソース ID を取得する。

具体的な型構文・色・JSON 値の形式は **[references/notion-property-reference.md](references/notion-property-reference.md)** を参照。

---

## 設計ワークフロー

### Step 1: 要件を聞き取る

最低限これだけ確認する（足りなければ 1 問ずつ聞く）：

1. **何を管理したいか**（タスク / 会議 / ナレッジ / 案件 …）→ パターン選定
2. **既存の関連 DB があるか**（relation を張る相手）
3. **機密度**（profile.md の `confidentiality`。Knowledge パターンの Confidentiality プロパティ要否に影響）

### Step 2: コアパターンを選ぶ

下表から最も近いものを 1 つ選び、**そのパターンファイルだけを Read する**（3 つ全部は読まない — 不要ロードを避ける）。完全一致でなくてよい。パターンをベースに不要プロパティを削り、必要なものを足す。

| パターン | 典型用途 | コアプロパティ | 読むファイル |
| --- | --- | --- | --- |
| **Tasks** | タスク・TODO・チケット管理 | Title / Status / Assignee / Due / Priority / Project / Tags | [references/patterns/tasks.md](references/patterns/tasks.md) |
| **Meetings** | 議事録・会議メモ | Title / Date / Attendees / Decisions / Action Items | [references/patterns/meetings.md](references/patterns/meetings.md) |
| **Knowledge** | ナレッジ・手順書・社内 wiki | Title / Category / Owner / Last Reviewed / Related / Confidentiality | [references/patterns/knowledge.md](references/patterns/knowledge.md) |

> 全パターン共通の設計原則・アンチパターンは [references/best-practices.md](references/best-practices.md)。要点は下記「設計時に必ず守ること」に集約済みなので、込み入った設計レビュー時のみ読めばよい。

### Step 3: DDL を組み立てて作成する

- パターンのプロパティ表を [references/notion-property-reference.md](references/notion-property-reference.md) の型構文に変換し、`CREATE TABLE (...)` を組む。
- **DB 名は英語**（`Tasks`, `Meeting Notes`）、**プロパティ名は日本語可**（`タスク名`, `ステータス`）。命名規約は [references/best-practices.md](references/best-practices.md) §5 を参照。
- relation を含む場合は **2 段階**で作る（下記）。

### Step 4: relation は 2 段階で張る

relation は参照先データソース ID が必要なため、作成前に相手 DB を `notion-fetch` する。自己参照（親子タスク等）は、まず DB を作ってから自身のデータソース ID を使って `update-data-source` で追加する（property-reference の relation 節を参照）。

### Step 5: View を 3 セット用意し、確認する

作成後、用途に応じた View（Board / Timeline / フィルタ済み個人ビュー等）を提案する。書き込み（DB 作成・プロパティ変更）の前には必ず設計内容を利用者に要約提示して確認を取る。

---

## 設計時に必ず守ること（要点）

詳細とアンチパターンは [references/best-practices.md](references/best-practices.md) に集約。要点だけ：

- **正規化**: 取りうる値が決まっているものは `RICH_TEXT` ではなく `SELECT` / `MULTI_SELECT` / `STATUS` に寄せる。
- **進捗は `STATUS`**: タスクの状態を自由記述テキストにしない。
- **relation は最小限**: 「何と何を本当に紐付ける必要があるか」を起点に。総当たりで張らない。
- **rollup は件数に注意**: 参照先が 100 件を超えると重くなる。集計頻度の高い指標だけに使う。
- **1 つの DB に全部詰め込まない**: 役割の違うデータは DB を分けて relation で繋ぐ。

---

## ファイル参照

設計に必要な 1〜2 ファイルだけを Read する（全部は読まない）：

- スキーマパターン（**該当 1 つだけ**）: [references/patterns/tasks.md](references/patterns/tasks.md) / [references/patterns/meetings.md](references/patterns/meetings.md) / [references/patterns/knowledge.md](references/patterns/knowledge.md)
- 全パターン共通のベストプラクティス・アンチパターン: [references/best-practices.md](references/best-practices.md)
- 型構文・色・JSON 値リファレンス（DDL / create-pages）: [references/notion-property-reference.md](references/notion-property-reference.md)
- REST API 直叩き時の JSON（例外・最終手段）: [references/notion-rest-api-appendix.md](references/notion-rest-api-appendix.md)

> 残り 3 パターン（Decisions / Deals / Incidents）は Phase 1 配布後に `references/patterns/` へ追加予定（MVP では Tasks / Meetings / Knowledge の 3 コアのみ）。
