# ゴールファイル書式（正本）

`~/.belta/goals/<slug>.md` と索引 `GOALS.md` の書式。パーサ（`hooks/goal-util.js`）と
SessionStart の再開検知（`hooks/session-start.js` (G)）がこの書式を前提に読むため、
**ここに無い記法を発明しない**こと。

## ゴールファイル `<slug>.md`（真実のソース）

```markdown
---
goal: 営業月次レポートを作って部長に共有する
slug: monthly-sales-report
status: active
created_at: 2026-06-10
updated_at: 2026-06-10
target_date: 2026-06-20
---

# ゴール: 営業月次レポートを作って部長に共有する

## ステップ
- [x] 1. Google Drive から今月の売上スプレッドシートを取得 <!-- done:2026-06-10 -->
- [!] 2. 先月分レポートと体裁を揃えて整形 <!-- blocked:先月レポートの URL 待ち -->
- [ ] 3. Notion に月次レポートページを作成
- [ ] 4. 公開前チェック（数字の整合・機密情報の有無）
- [ ] 5. Slack #営業部 で部長にメンション付き共有

## メモ
- [session:abc123] 2026-06-10 ステップ1完了。シート URL: ...
```

### frontmatter（単純な `key: value` 行のみ。ネスト・複数行値は使わない）

| キー | 必須 | 値 |
| --- | --- | --- |
| `goal` | ✔ | ゴール文（何が達成されたら完了か、1 文） |
| `slug` | ✔ | ASCII kebab-case。ファイル名（拡張子抜き）と一致させる |
| `status` | ✔ | `active`（進行中）/ `done`（全ステップ完了）/ `archived`（一覧から非表示） |
| `created_at` | ✔ | 作成日 `YYYY-MM-DD` |
| `updated_at` | ✔ | 最終更新日 `YYYY-MM-DD`。**進捗を書くたびに必ず更新**（stale 検知の基準） |
| `target_date` | 任意 | 期日 `YYYY-MM-DD`。scheduler リマインドの材料 |

### `## ステップ` セクション

- パーサは **`## ステップ` 見出しから次の `##` まで** のチェックボックス行だけを進捗として数える。
- チェックボックスは 3 状態のみ:
  - `- [ ]` … pending（未着手）
  - `- [x]` … done（完了）。行末に `<!-- done:YYYY-MM-DD -->` を付ける
  - `- [!]` … blocked（進められない）。行末に `<!-- blocked:理由 -->` を付ける（理由に `-->` を含めない）
- ステップ本文は「N. 内容」の通し番号付きを推奨（再開時の指示が明確になる）。
- ステップ数は 3〜10 件。多すぎる場合はゴール自体を分割する。

### `## メモ` セクション（任意）

経緯・URL・申し送りを自由に書く。`[session:<id>] YYYY-MM-DD` で始めると出所が追える。
**チェックボックスを書かない**（進捗には数えられないが、利用者が誤読する）。

## 索引 `GOALS.md`（表示専用）

goal スキルがゴール作成・進捗更新のたびに upsert する 1 行形式。
**走査（`goal-scan.js` / SessionStart (G)）はこのファイルを読まない**ので、
古くても実害は無いが、利用者が一目で全体を見るために最新に保つ。

```markdown
# GOALS — belta ゴール索引

このファイルは goal スキルが upsert する。実体は ~/.belta/goals/<slug>.md（そちらが真実のソース）。
<!-- 形式: - <slug> — <ゴール> [status:active|done|archived / steps:done/total / updated:YYYY-MM-DD] -->

- monthly-sales-report — 営業月次レポートを作って部長に共有する [status:active / steps:1/5 / updated:2026-06-10]
```

upsert の作法: 同じ slug の行が在れば置換、無ければ末尾に追記（`notes-record.js` の
`[session:<id>]` 行 upsert と同じ流儀）。他の行は保全する。
