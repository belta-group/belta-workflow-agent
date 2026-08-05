# 専用 subagent の生成雛形（agent-learning 用）

`agent-learning` スキルが、同一業務領域を 5 営業日以内に 2 回検出したときに
専用フォルダの `<agent_home>/.claude/agents/<slug>.md` を生成する際の **frontmatter 雛形**。

モデルは **役割に応じてティアで決める**（対応表は [model-tiers.md](../../workflow/references/model-tiers.md)。モデル名を書く唯一の場所）。既定は指定せずセッション継承。

---

## frontmatter 雛形

```markdown
---
name: <slug>                      # kebab-case。AGENTS.md のキーと一致させる
description: <この subagent をいつ起動するか。1 文で具体的に。委譲判定に使われる>
tools: <親 .claude/settings.json allow の部分集合のみ>   # 権限は継承ではなく明示的に絞る
# model: <役割がレビュー/検証なら opus、機械作業専任なら haiku。それ以外は行ごと省略>
#        ※ ティア定義は skills/workflow/references/model-tiers.md。バージョン直書きは禁止
source_notes:                      # 生成根拠にした notes（再学習・監査用）
  - .belta/notes/<YYYY-MM-DD>.md
  - .belta/notes/<YYYY-MM-DD>.md
created_at: <YYYY-MM-DD>
---

<システムプロンプト本文：この領域でのふるまい・出力様式・禁止事項>
```

---

## `model` フィールドの決め方（ティアで判断する）

**既定は `model` を置かない**（セッションのモデルを継承）。ただし subagent の役割が次に当たるときだけ明示する。バージョン付き ID（`claude-opus-5` 等）は世代交代に追従しないので**書かない**。エイリアスで書く。

| その subagent の役割 | ティア | frontmatter |
| --- | --- | --- |
| レビュー・検証・事実確認・妥当性の判定が主目的 | senior 以上 | `model: opus` |
| 設計・最終品質チェックが主目的 | apex | `model: opus` |
| 整形・一括処理・データ収集など機械作業の専任 | light | `model: haiku` |
| それ以外（通常の業務代行） | — | 指定しない（セッション継承） |

理由: 判定作業を下位ティアで完結させると誤りを見逃す。逆に機械作業を上位ティアで回すとトークンを無駄に食う。専用フォルダの既定は apex なので、**機械作業専任の subagent には `model: haiku` を明示するほうがコスト面で効く**（[model-tiers.md](../../workflow/references/model-tiers.md) §4 の規律）。

---

## 権限・セキュリティ（必須）

- `tools` は親 `.claude/settings.json` の allow の **部分集合のみ**。権限は明示的に絞ること。
- 生成 subagent 経由でも PII 検知フック（`hooks/pre-tool-use.js`）が発火することを前提にする。
- パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決し、
  区切り文字を直書きしない（Mac / Windows 両対応）。
