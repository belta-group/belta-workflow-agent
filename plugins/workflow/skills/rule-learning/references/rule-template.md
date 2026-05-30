# ルール .md の雛形（rule-learning 用）

`rule-learning` スキルが利用者承認後に `~/.belta/rules/<slug>.md` を生成する際の **frontmatter 雛形** と、インデックス `RULES.md` の **初期テンプレート**。

---

## 個別ルール frontmatter 雛形

```markdown
---
name: <kebab-case-slug>          # ファイル名（拡張子なし）と一致。RULES.md のリンク先キー
description: <一行サマリ。RULES.md に載る・将来の関連性判断に使う>
type: <preference | mistake-fix | workflow | domain-knowledge>
created: <YYYY-MM-DD>
source: <検知トリガの発話 or 操作。例: 発話「日付は毎回 YYYY-MM-DD で」>
---

## ルール
<このルールの本文。エージェントが従うべき具体的な振る舞いを 1〜数文で>

## 適用条件
<いつ発動するか。例: Notion / Slack に日付を書き込むすべての場面>

## 由来
<なぜこのルールができたか・前回までの文脈。再学習や統廃合時の判断材料>
```

### `type` の使い分け

| type | 意味 | 例 |
| --- | --- | --- |
| `preference` | 出力様式・口調・形式の好み | 日付は ISO、要約を冒頭に置く |
| `mistake-fix` | 同じ訂正を繰り返させないための修正 | 部署名の正式表記、宛先の取り違え防止 |
| `workflow` | 手順・段取りの定型化 | 議事録は Notion 保存後に Slack 共有まで一括 |
| `domain-knowledge` | 業務固有の知識・前提 | 「本番」は staging を指す、承認者は◯◯ |

---

## 記入例

```markdown
---
name: date-format-iso
description: 日付は常に YYYY-MM-DD 形式で出力する
type: preference
created: 2026-05-30
source: 発話「次回からは日付は YYYY-MM-DD で」
---

## ルール
日付を出力・記録するときは常に `YYYY-MM-DD`（ISO 8601）形式を使う。和暦・スラッシュ区切り・曜日付きは使わない。

## 適用条件
Notion / Slack / notes への書き込み、画面表示を含むすべての日付出力。

## 由来
2 回続けて「日付は YYYY-MM-DD で」と訂正されたため恒常ルール化。
```

---

## RULES.md 初期テンプレート（インデックス）

`~/.belta/rules/RULES.md` が存在しない状態で初めてルールを保存するときに、この内容で新規作成してから 1 行追記する。運営モード起動時に毎回 Read される索引であり、本文ではなく 1 行サマリだけを持つ（省トークン）。

```markdown
# RULES — 学習済みルール索引

このファイルは `rule-learning` が自動生成・追記する。運営モード起動時に毎回読み込まれ、
各ルールの本文（`<slug>.md`）は必要時のみ Read する。1 ルール 1 行・上限 200 行。

<!-- 追記形式: - [<slug>](<slug>.md) — <description> -->
```

### 追記 1 行の形式

```
- [date-format-iso](date-format-iso.md) — 日付は常に YYYY-MM-DD 形式で出力する
```

---

## rejected 履歴（`.rejected.md`）

利用者が提案を拒否した場合の記録先。同一候補は 3 回目まで再提案しない。

```
- <YYYY-MM-DD> | <候補slug> | <要約> | rejected (<回数>)
```

- 回数は「意図が同じ候補」でまとめてカウントする（slug 完全一致でなく LLM 判定）。
- `(3)` 到達後はその候補の提案を完全停止する。
