---
name: agent-learning
description: >
  同一の業務領域が繰り返し現れたとき、その領域専用の Claude Code subagent を
  `~/.belta/agents/` に生成し `~/.claude/agents/` へ symlink して標準 Agent ツールから
  呼べる状態にする。直近 5 営業日の `~/.belta/notes/` に同じ業務領域への発話が 2 回以上
  出たときに workflow スキルから委譲され、専用エージェント化を提案する。
---

# 自動エージェント化（agent-learning）

要件 5 の拡張。テキスト指示（[rule-learning](../rule-learning/SKILL.md)）に収まらない「**業務領域そのもの**」が繰り返し現れたら、その領域専用の subagent を生成し、以降は標準 `Agent` ツールから呼び出せるようにする。

- 正本: `~/.belta/agents/<slug>.md`
- 呼び出し用: `~/.claude/agents/<slug>.md`（正本への symlink。Windows 等で symlink 不可なら **コピー** にフォールバック）

ルール（テキスト）化で足りるものは rule-learning に、既存スキルで賄える非効率作業は [skill-suggestion](../skill-suggestion/SKILL.md) に回す。本スキルは **領域単位で独立した振る舞い・権限を持たせるべき** 繰り返しを扱う。

## いつ使うか（検知トリガ）

### 直近 5 営業日の notes 走査 → 同一領域 2 回検出

運営モードの起動時、または会話が一段落したタイミングで：

1. `~/.belta/notes/` のうち **直近 5 営業日**（土日を除外した暦日。祝日は考慮しない簡易判定でよい）のファイルを Read する。
2. 各記録の業務発話に **業務領域ラベル**（例: 「Notion DB 設計」「営業案件レビュー」「インフラ障害対応」「週次ワークフロー改善」）を LLM で付与する。完全一致でなく **意図が同じ領域** でまとめる。
3. 同一領域ラベルが **2 回以上** 出現したら、その領域を専用エージェント化の候補にする。

> 「2 回」は窓内の異なる機会での出現を数える。1 回の会話を分割して 2 回に数えない。

---

## 自動化フロー

### Step 1: 領域名と必要権限を推定して提案

1. 候補領域の `slug` を kebab-case で決める（例: `notion-db-design`, `sales-deal-review`）。
2. その領域で必要になる **MCP ツールのサブセット** を推定する。これは必ず **親 `.claude/settings.json` の `allow` の部分集合**（[参照](../../.claude/settings.json)）に収める。`ask` / `deny` のものは渡さない。最小権限で絞る。
3. 利用者に **AskUserQuestion**（エージェント化する / 今回は不要、+ 自由記述）で確認する：

> 「最近『○○』の作業が続いています。`<slug>` という専用エージェントにしておくと、次回から `Agent` ツールで一発で呼べます。作成しますか？」

### Step 2-a: 承認 → 生成 + symlink + 記録

1. [references/agent-template.md](references/agent-template.md) の frontmatter 雛形と **モデル選択ポリシー（haiku / sonnet / inherit の 3 段）** に従い、`model` を業務カテゴリで出し分けて `~/.belta/agents/<slug>.md` を **Write ツールで生成**する。
   - `tools` は Step 1 で絞った allow サブセットのみ。
   - `source_notes` に検知元の `notes/YYYY-MM-DD.md`（2 件以上）を記録する。
2. symlink（不可ならコピー）を作成する。クロスプラットフォームのため Node.js ヘルパーを使う：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/agent-learning/scripts/link-agent.js" link <slug>
   ```

   - 出力 JSON の `mode` が `symlink` か `copy` かを確認する。`copy` の場合は正本を更新しても自動反映されない旨を `AGENTS.md` の備考に残す。
3. インデックス `~/.belta/agents/AGENTS.md` に **fired / adopted** を記録する（後述）。
4. 「`<slug>` を作成しました。次回から『○○して』と言えばこのエージェントに委譲します」と返す。

### Step 2-b: 拒否 → rejected 記録 + 冷却

`AGENTS.md` に `rejected` を記録する。**同一領域を 3 回連続で却下されたら 14 営業日の冷却**（提案停止）に入れる。冷却期間と回数は `AGENTS.md` の当該行に残す。

---

## 採用後の継続追跡（起動時の symlink 健全性確認）

運営モード起動時、`AGENTS.md` に adopted 記録がある各エージェントについて、リンク先の健全性を確認する：

```
node "${CLAUDE_PLUGIN_ROOT}/skills/agent-learning/scripts/link-agent.js" check
```

- 出力は各 `<slug>` の `status`（`ok` / `deleted` / `broken`）。
- `deleted`（`~/.claude/agents/<slug>.md` が消えている）を検知したら、`AGENTS.md` の該当行に `deleted_at:<YYYY-MM-DD>` を記録する（採用 → 削除の継続率メトリクス取得）。一度記録した deleted は再通知しない。
- `broken`（symlink は在るが正本が消えた）は利用者に知らせ、再生成 or 行削除を確認する。

---

## AGENTS.md の管理（常に LLM 文脈に読込）

`~/.belta/agents/AGENTS.md` は起動時に毎回 Read されるインデックス。発火・採用・削除・却下を 1 行で追跡する。

### 初期化（無ければ作成）

初めてエージェントを扱うとき、次の内容で新規作成してから追記する：

```markdown
# AGENTS — 自動生成エージェント索引

このファイルは `agent-learning` が自動生成・追記する。起動時に毎回読み込まれ、
発火 / 採用 / 削除 / 却下を追跡する。各エージェント本文（`<slug>.md`）は委譲時のみ Read する。

<!-- 追記形式: - [<slug>](<slug>.md) — <description> [fired:YYYY-MM-DD / adopted:YYYY-MM-DD / deleted:- ] -->
```

### 追記 1 行の形式

```
- [notion-db-design](notion-db-design.md) — Notion DB のスキーマ設計を任せる [fired:2026-05-28 / adopted:2026-05-28 / deleted:-]
```

- 却下は `[fired:YYYY-MM-DD / rejected:YYYY-MM-DD (n) / cooldown_until:YYYY-MM-DD]` の形で残す。
- リンクが symlink でなくコピーの場合は行末に `(copy)` を付す。

---

## セキュリティ境界

- 生成 subagent の `tools` は親 `.claude/settings.json` の `allow` の **部分集合のみ**。`ask` / `deny` 相当の書き込み・破壊系を直接渡さない（多段階権限階層は Phase -1 では実装しない）。
- 親の PII 検知フック（`hooks/pre-tool-use.js`）は **subagent 経由でも発火する**ことを前提にする。モデルや権限の選択は防御を肩代わりしない（[security-policies.md](../workflow/references/security-policies.md) §3）。
- 生成 subagent がさらに子 subagent を作る連鎖は行わない。
- パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。symlink/コピーの作成は同梱 Node.js ヘルパーに委ね、`ln -s` 等の POSIX コマンドを必須経路に置かない（Mac / Windows 両対応）。
- `~/.belta/agents/` 配下は `.gitignore` 対象。リポジトリにコミットしない。

## ファイル参照

- frontmatter 雛形・モデル選択ポリシー: [references/agent-template.md](references/agent-template.md)
- symlink/コピー作成・健全性確認ヘルパー: [scripts/link-agent.js](scripts/link-agent.js)
- 親の権限 allowlist（tools サブセットの上限）: [.claude/settings.json](../../.claude/settings.json)
- テキスト指示で足りる繰り返し: [rule-learning](../rule-learning/SKILL.md)
