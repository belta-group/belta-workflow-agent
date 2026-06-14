# 専用 subagent の生成雛形（agent-learning 用）

`agent-learning` スキルが、同一業務領域を 5 営業日以内に 2 回検出したときに
専用フォルダの `<agent_home>/.claude/agents/<slug>.md` を生成する際の **frontmatter 雛形**。

生成エージェントはモデルを `frontmatter` で指定せず、セッションのモデルをそのまま継承する。

---

## frontmatter 雛形

```markdown
---
name: <slug>                      # kebab-case。AGENTS.md のキーと一致させる
description: <この subagent をいつ起動するか。1 文で具体的に。委譲判定に使われる>
tools: <親 .claude/settings.json allow の部分集合のみ>   # 権限は継承ではなく明示的に絞る
source_notes:                      # 生成根拠にした notes（再学習・監査用）
  - .belta/notes/<YYYY-MM-DD>.md
  - .belta/notes/<YYYY-MM-DD>.md
created_at: <YYYY-MM-DD>
---

<システムプロンプト本文：この領域でのふるまい・出力様式・禁止事項>
```

> `model` フィールドは置かない。セッションのモデルをそのまま使う。

---

## 権限・セキュリティ（必須）

- `tools` は親 `.claude/settings.json` の allow の **部分集合のみ**。権限は明示的に絞ること。
- 生成 subagent 経由でも PII 検知フック（`hooks/pre-tool-use.js`）が発火することを前提にする。
- パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決し、
  区切り文字を直書きしない（Mac / Windows 両対応）。
