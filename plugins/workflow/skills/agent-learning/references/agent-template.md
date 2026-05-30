# 専用 subagent の生成雛形（agent-learning 用）

`agent-learning` スキルが、同一業務領域を 5 営業日以内に 2 回検出したときに
`~/.belta/agents/<slug>.md` を生成する際の **frontmatter 雛形** と **モデル選択ポリシー**。

生成エージェントは親（`/workflow`）と同じモデルを無条件に継承するのではなく、
**その subagent が担う業務の性質に応じて `model` を出し分ける**（コスト最適化）。

---

## frontmatter 雛形

```markdown
---
name: <slug>                      # kebab-case。AGENTS.md のキーと一致させる
description: <この subagent をいつ起動するか。1 文で具体的に。委譲判定に使われる>
tools: <親 plugin.json allow の部分集合のみ>   # 権限は継承ではなく明示的に絞る
model: <haiku | sonnet | inherit>  # 下記「モデル選択ポリシー」で決定（inherit を既定にしない）
source_notes:                      # 生成根拠にした notes（再学習・監査用）
  - .belta/notes/<YYYY-MM-DD>.md
  - .belta/notes/<YYYY-MM-DD>.md
created_at: <YYYY-MM-DD>
---

<システムプロンプト本文：この領域でのふるまい・出力様式・禁止事項>
```

> `model` を空欄や `inherit` の固定にしない。必ず下のポリシーでカテゴリを判定し、
> `haiku` / `sonnet` / `inherit` のいずれかを選んで埋めること。

---

## モデル選択ポリシー（3 段）

生成対象の業務カテゴリを判定し、対応するモデルを `model` に設定する。
迷ったら **一段上（より高性能側）** を選ぶ（品質劣化のほうが手戻りコストが高いため）。

| カテゴリ | 判断レベル | 代表例 | `model` |
| --- | --- | --- | --- |
| 抽出・整形・列挙系 | 低（定型・機械的） | ファイル/PR/Issue の一覧取得、PDF・議事録の文字起こし整形、定型ラベル付け、単純集計、テンプレ差し込み | `haiku` |
| 標準業務自動化 | 中 | Notion へのメモ/タスク整理、Slack 共有文面の作成、PR/Issue 要約、定型の複数ツール連携 | `sonnet` |
| 設計・分析・高機密判断 | 高 | Notion DB スキーマ設計、要件分析・仕様化、複雑な多段オーケストレーション、社外秘/極秘データの送信可否判断 | `inherit` |

### 補足

- **最上段は `opus` 直書きではなく `inherit`** にする。利用者がセッションで使う最上位モデルを
  そのまま継承でき、将来モデルが変わっても追随できる（ハードコード回避）。
- 1 つの subagent が複数カテゴリにまたがる場合は、**含まれる最上位カテゴリ**で決める。
- 生成後に実運用で重い/軽いと分かったら、`AGENTS.md` の記録を根拠に `model` を見直してよい
  （格上げ・格下げどちらも可）。変更履歴は `AGENTS.md` に残す。

---

## 権限・セキュリティ（モデルとは独立に必須）

- `tools` は親 `plugin.json` の allow の **部分集合のみ**。モデルを下げても権限は別途絞ること。
- 生成 subagent 経由でも PII 検知フック（`hooks/pre-tool-use.js`）が発火することを前提にする
  （モデル選択は防御を肩代わりしない）。
- パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決し、
  区切り文字を直書きしない（Mac / Windows 両対応）。
