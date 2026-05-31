---
name: agent-learning
description: >
  同一の業務領域が繰り返し現れたとき、その領域専用の Claude Code subagent を
  専用フォルダ（~/my-agent）の `.claude/agents/` に直接生成し、そのフォルダで標準
  Agent ツールから呼べる状態にする。同一セッション内で同じ業務依頼が 2 回以上出たとき、
  または直近 5 営業日の `~/.belta/notes/` に同じ業務領域への発話が 2 回以上出たときに
  workflow スキルから委譲され、専用エージェント化を提案する。
---

# 自動エージェント化（agent-learning）

要件 5 の拡張。テキスト指示（[rule-learning](../rule-learning/SKILL.md)）に収まらない「**業務領域そのもの**」が繰り返し現れたら、その領域専用の subagent を生成し、以降は標準 `Agent` ツールから呼び出せるようにする。

本プラグインは専用フォルダ（`~/my-agent`）限定（ローカルスコープ）で動くため、生成した subagent も **そのフォルダの `.claude/agents/` に直接置く** だけで、そのフォルダ内のセッションから自動的に `Agent` ツールへ載る。`~/.claude/`（グローバル）への symlink/コピー公開は **行わない**（ローカル限定方針と整合し、symlink 機構の保守も不要になる）。

- 実体: `<agent_home>/.claude/agents/<slug>.md`（`<agent_home>` は専用フォルダの絶対パス。後述の方法で解決）
- 索引: `~/.belta/agents/AGENTS.md`（発火・採用の追跡用。実体とは分離してホーム側に残す）

> **`<agent_home>` の解決**: `node "${CLAUDE_PLUGIN_ROOT}/scripts/belta-init.js" get agent_home` で専用フォルダの絶対パスを得る。空（未設定）の場合は、いま開いている専用フォルダ＝プロジェクトルートに相対の `.claude/agents/` を使ってよい（このスキルは専用フォルダ内のセッションでのみ走るため、カレントが専用フォルダになっている）。

ルール（テキスト）化で足りるものは rule-learning に、既存スキルで賄える非効率作業は [skill-suggestion](../skill-suggestion/SKILL.md) に回す。本スキルは **領域単位で独立した振る舞い・権限を持たせるべき** 繰り返しを扱う。

## いつ使うか（検知トリガ）

検知経路は 2 つ。**どちらか一方でも同じ業務領域／依頼の 2 回目を捉えたら候補化する**。反復は別セッションをまたぐものに限らず、**同一セッション内で同じ依頼を 2 回以上出した場合も含める**（同じ命令を繰り返す＝同じ作業を反復させている、とみなす）。

> **判定材料の前提**: 反復の検知は `~/.belta/notes/` の日次ログが土台。ここは `Stop` フック（`hooks/notes-record.js`）が「その日の利用者依頼」を 1 セッション 1 行で確定的に記録しているため、LLM の自動記録が漏れても最低限の履歴が残る。走査前にまず当日・直近の notes を Read すること。

### 経路 A: 直近 5 営業日の notes 走査 → 同一領域 2 回検出

運営モードの起動時、または会話が一段落したタイミングで：

1. `~/.belta/notes/` のうち **直近 5 営業日**（土日を除外した暦日。祝日は考慮しない簡易判定でよい）のファイルを Read する。
2. 各記録の業務発話に **業務領域ラベル**（例: 「Notion DB 設計」「営業案件レビュー」「インフラ障害対応」「週次ワークフロー改善」）を LLM で付与する。完全一致でなく **意図が同じ領域** でまとめる。
3. 同一領域ラベルが **2 回以上** 出現したら、その領域を専用エージェント化の候補にする。

> 「2 回」は **異なる機会での出現** を数える。別セッションだけでなく、**同一セッション内で同じ依頼を独立に 2 回以上出した記録**（notes の同一セッション行に同じ趣旨が複数回、または同日の別セッション行に出現）も 2 機会として数える。ただし **1 つのタスクを達成する過程の言い直し・追加指示・絞り込み（同じタスクの継続）は 1 機会に含める**（分割して数えない）。

### 経路 B: 同種の業務依頼の反復（訂正でなくても）

利用者が **同じ趣旨の業務依頼**（タスク要求そのもの）を **2 回以上** 繰り返したら候補化する。**別々のセッションをまたぐ反復だけでなく、同一セッション内で同じ依頼を 2 回以上出した場合も対象**とする。rule-learning が拾うのは「訂正」の反復だが、本経路が拾うのは「**依頼**」の反復である点が違う。

- 例: 「PR の状況確認して」を、同一セッション内で 2 回、または別セッションで再度依頼した → 「PR レビュー・状況確認」領域として候補化。
- **同一セッション内で 2 回目を認識した時点で、notes の確定を待たずその場で候補化し、AskUserQuestion で提案する**（割り込み等でその場提案ができなかったときは、次の機会または notes 走査〔経路 A〕が補完する）。
- 完全一致でなく **依頼の意図が同じか** で数える（言い回しの違いは無視）。ただし **1 つの依頼を達成する過程での言い直し・追加指示・絞り込みは 1 回**と数え、「一度依頼を完了（または中断）したうえで、改めて同じ依頼を再発行した」ことを 2 回目の条件とする。一度きりの単発依頼は対象外。

---

## 自動化フロー

### Step 1: 領域名と必要権限を推定して提案

1. 候補領域の `slug` を kebab-case で決める（例: `notion-db-design`, `sales-deal-review`）。
2. その領域で必要になる **MCP ツールのサブセット** を推定する。これは必ず **親 `.claude/settings.json` の `allow` の部分集合**（[参照](../../.claude/settings.json)）に収める。`ask` / `deny` のものは渡さない。最小権限で絞る。
3. 利用者に **AskUserQuestion**（エージェント化する / 今回は不要、+ 自由記述）で確認する：

> 「最近『○○』の作業が続いています。`<slug>` という専用エージェントにしておくと、次回から `Agent` ツールで一発で呼べます。作成しますか？」

### Step 2-a: 承認 → 生成 + 記録

1. [references/agent-template.md](references/agent-template.md) の frontmatter 雛形と **モデル選択ポリシー（haiku / sonnet / inherit の 3 段）** に従い、`model` を業務カテゴリで出し分けて `<agent_home>/.claude/agents/<slug>.md` を **Write ツールで生成**する（`<agent_home>` は上記の方法で解決。専用フォルダ内なら相対 `.claude/agents/<slug>.md` でもよい）。
   - `tools` は Step 1 で絞った allow サブセットのみ。
   - `source_notes` に検知元の `notes/YYYY-MM-DD.md`（2 件以上）を記録する。
   - symlink/コピーは不要。専用フォルダの `.claude/agents/` に置けば、そのフォルダのセッションで自動的に `Agent` ツールへ載る。
2. インデックス `~/.belta/agents/AGENTS.md` に **fired / adopted** を記録する（後述）。
3. 「`<slug>` を作成しました。次回からこの専用フォルダで『○○して』と言えばこのエージェントに委譲します」と返す。

### Step 2-b: 拒否 → rejected 記録 + 冷却

`AGENTS.md` に `rejected` を記録する。**同一領域を 3 回連続で却下されたら 14 営業日の冷却**（提案停止）に入れる。冷却期間と回数は `AGENTS.md` の当該行に残す。

---

## 採用後の継続追跡（起動時の実体存在確認）

運営モード起動時、`AGENTS.md` に adopted 記録がある各エージェントについて、実体ファイルが残っているかを確認する：

- `<agent_home>/.claude/agents/<slug>.md` が存在するかを Read（または `node "${CLAUDE_PLUGIN_ROOT}/scripts/belta-init.js" get agent_home` で解決したパス配下の一覧）で確認する。
- 実体が **消えている**（利用者が削除した）場合は、`AGENTS.md` の該当行に `deleted_at:<YYYY-MM-DD>` を記録する（採用 → 削除の継続率メトリクス取得）。一度記録した deleted は再通知しない。
- 実体は在るが **frontmatter が壊れている**（`name`/`description` 欠落で Agent ツールに載らない）場合は利用者に知らせ、再生成 or 行削除を確認する。

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

---

## セキュリティ境界

- 生成 subagent の `tools` は親 `.claude/settings.json` の `allow` の **部分集合のみ**。`ask` / `deny` 相当の書き込み・破壊系を直接渡さない（多段階権限階層は Phase -1 では実装しない）。
- 親の PII 検知フック（`hooks/pre-tool-use.js`）は **subagent 経由でも発火する**ことを前提にする。モデルや権限の選択は防御を肩代わりしない（[security-policies.md](../workflow/references/security-policies.md) §3）。
- 生成 subagent がさらに子 subagent を作る連鎖は行わない。
- パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。実体は専用フォルダの `.claude/agents/` に **Write ツールで直接配置**するだけで、`ln -s` 等の OS 依存コマンドは使わない（Mac / Windows 両対応）。
- 索引 `~/.belta/agents/AGENTS.md` はホーム側にあり `.gitignore` 対象。生成した subagent 実体は専用フォルダ `~/my-agent/.claude/agents/` 配下に置かれる（`/workflow-setup` が専用フォルダに `.gitignore` を用意し、誤コミットを防ぐ）。

## ファイル参照

- frontmatter 雛形・モデル選択ポリシー: [references/agent-template.md](references/agent-template.md)
- 専用フォルダのパス解決: [scripts/belta-init.js](../../scripts/belta-init.js)（`get agent_home`）
- 親の権限 allowlist（tools サブセットの上限）: [.claude/settings.json](../../.claude/settings.json)
- テキスト指示で足りる繰り返し: [rule-learning](../rule-learning/SKILL.md)
- 既製スキルで賄える非効率作業: [skill-suggestion](../skill-suggestion/SKILL.md)
- 委譲でなく主作業に差し込む専門手順を自作する: [skill-authoring](../skill-authoring/SKILL.md)
