---
name: scheduler
description: >
  定期実行（毎朝のTODO要約・週次の振り返り・週次の inbox 監査など）を登録・管理する。
  「毎朝」「毎週」「定期的に」「毎日○時に」「リマインド」「週次で」「自動でやっておいて」等の
  発話、または /workflow-schedule コマンドで workflow スキルから委譲される。発火は
  mcp__scheduled-tasks（主）/ CronCreate（副）に委譲し、各ジョブは会話履歴ゼロでも動く
  自己完結プロンプトとして登録する。
---

# 定期実行（scheduler）

NousResearch/hermes-agent の自然言語 cron スケジューラ相当。**同じ種類の仕事を毎回手で頼まなくても、決めた時刻に秘書が勝手に動く** ようにする。「貯める／その場で分岐する」だけだった belta を、能動的に動く秘書へ引き上げる中核機能。

- 発火（実体）: Claude Code の `mcp__scheduled-tasks` に委譲（永続・再起動耐性）。副経路は `CronCreate(durable)`。
- 決定的補助: `scripts/schedule-spec.js`（cron 生成・検証・既存ジョブ列挙）。
- 知識（このスキル）: どのテンプレを・いつ・どんな自己完結プロンプトで登録するか。

> **最重要の前提**: スケジュールジョブは **会話履歴を持たない独立セッション** で、登録した SKILL.md プロンプトだけを実行する。よって belta のジョブ本文は「専用フォルダを解決して `~/.belta` を読む手順」まで含む **完全自己完結プロンプト** にする（[references/job-templates.md](references/job-templates.md) の雛形を使う）。

## いつ使うか（トリガ）

- `/workflow-schedule [...]` を実行したとき
- 「毎朝」「毎週」「毎日○時に」「定期的に」「週次で」「リマインド」「自動でやっておいて」等の発話
- `insights` / `user-model` を「これからは定期的に」と頼まれたとき（週次ジョブ化）

## 登録フロー

### Step 0: 環境の確認（フォールバック判定）

1. `mcp__scheduled-tasks__create_scheduled_task` が使えるかを確認する（ツール一覧にあるか／一度 `list_scheduled_tasks` を呼べるか）。
   - 使える → **主経路**（Step 1 へ）。
   - 使えない → ビルトイン `CronCreate(durable: true)` を試す（**副経路**）。`recurring` は 7 日で失効するため、JOBS.md に「失効前に再登録」を明記する。
   - どちらも無い → **手動運用へ縮退**。「お使いの環境では自動定期実行が使えないため、朝この `/insights` を叩いてください」のように案内し、登録はしない。

### Step 1: 何を・いつ実行するかを決める

1. **何を** — [references/job-templates.md](references/job-templates.md) から目的に合うテンプレを選ぶ（毎朝 TODO 要約 / 週次 notes 振り返り＝insights / 週次 user-model 深化 / 週次 inbox 監査）。利用者独自の依頼ならテンプレを土台に本文を組む。
2. **いつ** — 頻度語から cron 候補を出す：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/schedule-spec.js" cron "<利用者の頻度語>"
   ```

   候補が複数あれば `AskUserQuestion` で確認する。利用者が cron を直接指定したら検証する：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/schedule-spec.js" validate "<cron>"
   ```

### Step 2: 自己完結プロンプトを組む

選んだテンプレの本文に、実際の値（日数・出力ファイル名・通知先など）を埋める。**会話履歴ゼロで動く** ことを必ず確認する（このセッションの文脈を前提にしない）。プロンプトには最低限、次を含める：

1. 専用フォルダの解決: `node "<plugin>/scripts/belta-init.js" get agent_home`（`<plugin>` は絶対パスで埋め込む。`${CLAUDE_PLUGIN_ROOT}` は独立セッションで展開されない可能性があるため、登録時点で解決した絶対パスを本文に焼き込む）。
2. `~/.belta` の読込（todos / notes など目的に応じて）。
3. 必要なら `notes-scan.js` の実行。
4. LLM による要約・判断。
5. 生成物を `~/.belta/reports/` に Write。
6. （任意）Slack 等への通知（profile.md の機密度を尊重）。

> **絶対パスの焼き込み**: 登録時に `${CLAUDE_PLUGIN_ROOT}` を実際の絶対パスへ解決してプロンプトに書く。プラグイン更新でパスが変わる可能性があるため、JOBS.md に解決済みパスを記録し、パス変更を検知したら再登録する。

### Step 3: 登録

`mcp__scheduled-tasks__create_scheduled_task` を呼ぶ：

- `taskId`: `belta-wf-<用途>`（例: `belta-wf-morning-todo`, `belta-wf-weekly-notes`, `belta-wf-user-model`, `belta-wf-inbox-audit`）。**`belta-wf-` プレフィクス必須**（利用者の他用途ジョブと混ざらないため。`belta-` だけだと衝突しうる）。
- `cronExpression`: Step 1 で決めた式（ローカルタイムゾーンで評価される。UTC 変換不要）。
- `prompt`: Step 2 の自己完結本文。
- `description`: 一行説明。

### Step 4: 索引に記録

`~/.belta/scheduler/JOBS.md` に 1 行追記する（無ければ作成）。実体（SKILL.md）は `~/.claude/scheduled-tasks/<taskId>/` 側にあるため、belta は **索引だけ** 持つ（AGENTS.md / RULES.md と同じ「索引はホーム側」パターン）。

```markdown
# JOBS — belta 定期ジョブ索引

このファイルは scheduler が追記する。実体は ~/.claude/scheduled-tasks/<taskId>/SKILL.md。
<!-- 形式: - <taskId> — <目的> [cron:<式> / registered:YYYY-MM-DD / engine:mcp|cron / plugin_root:<絶対パス>] -->
```

完了したら「`belta-wf-weekly-notes` を登録しました。毎週月曜 9:03 に先週の振り返りを `~/.belta/reports/` に出します。アプリを閉じている間に時刻が来たら次回起動時に動きます」のように、**動作タイミングの注意も添えて** 返す。

## 一覧・削除・更新

- **一覧**: `node "${CLAUDE_PLUGIN_ROOT}/scripts/schedule-spec.js" list` で `belta-wf-` ジョブを列挙。あわせて `mcp__scheduled-tasks__list_scheduled_tasks` で `nextRunAt` / `lastRunAt` / `enabled` を確認し、突き合わせて表示する。
- **削除/停止**: `mcp__scheduled-tasks__update_scheduled_task`（`enabled: false` で停止）で対象を停止。完全削除は MCP の削除手段に従う。JOBS.md の該当行に `disabled_at` / `deleted_at` を記録する。
- **更新**: 頻度や本文を変えるときは `update_scheduled_task` で `cronExpression` / `prompt` を差し替える。

## 機能間連携（このスキルがハブ）

- 週次「notes 振り返り」ジョブ = `insights` を定期実行（`belta-wf-weekly-notes`）。
- 週次/隔週「user-model 深化」ジョブ = `user-model` を定期実行（`belta-wf-user-model`）。

いずれもジョブ本文に各スキルの手順（`notes-scan.js` の実行と要約）を焼き込む。独立セッションでは「スキルを呼ぶ」のでなく **手順を直接書く** ことに注意（テンプレ参照）。

## 重要な注意事項

- `taskId` は必ず `belta-wf-` プレフィクス。
- ジョブ本文は会話履歴ゼロで動く自己完結プロンプト。`${CLAUDE_PLUGIN_ROOT}` は登録時に絶対パスへ解決して焼き込む。
- 生成物は `~/.belta/reports/`（`notes/` の配下に置かない＝retention の誤削除を避ける）。
- 機密度（profile.md）を尊重。定期ジョブが外部（Slack 等）へ送る場合、自己完結プロンプト内にも機密配慮の指示を書く（PII 検知フックが二重で守るが、プロンプト側でも明示）。
- 登録・削除は破壊的になりうるので、`AskUserQuestion` で内容（何を・いつ・どこへ）を確認してから実行する。
- パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決。`mkdir`/`touch` を必須経路に置かない（Write ツールで JOBS.md を作る）。

## ファイル参照

- cron 生成・検証・ジョブ列挙: [scripts/schedule-spec.js](../../scripts/schedule-spec.js)
- 自己完結ジョブ本文の雛形: [references/job-templates.md](references/job-templates.md)
- 専用フォルダのパス解決: [scripts/belta-init.js](../../scripts/belta-init.js)（`get agent_home`）
- 定期実行する振り返り: [insights](../insights/SKILL.md)
- 定期実行するユーザーモデル深化: [user-model](../user-model/SKILL.md)
