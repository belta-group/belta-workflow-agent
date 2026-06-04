---
description: 定期実行（毎朝のTODO要約・週次の振り返りなど）を登録/一覧/削除する。自然言語で頻度を指定でき、無人で動く秘書の定期ジョブを管理。
argument-hint: "[登録したい定期タスクの説明 / list / remove]"
model: inherit
---

<!--
model: inherit — 自己完結ジョブ本文の生成（独立セッションで動く完全な手順を書く）に
判断力が要るため、セッションのモデルを継承する。cron 生成・検証・列挙という決定的部分は
scripts/schedule-spec.js が担い、登録の実体は mcp__scheduled-tasks に委譲する二層構造。
-->

# /workflow-schedule — 定期実行の登録・管理

`scheduler` スキル（`skills/scheduler/SKILL.md`）を起動する入口コマンド。NousResearch/hermes-agent の自然言語 cron スケジューラ相当を、Claude Code の `mcp__scheduled-tasks` に委譲して実現する。

できること:

- **登録** — 「毎朝9時にTODOを要約して」「毎週月曜に先週の振り返りを出して」のように頼むと、無人で動く定期ジョブを作る。
- **一覧** — `/workflow-schedule list` で登録済みの belta ジョブを表示。
- **削除/停止** — `/workflow-schedule remove` で対象を選んで削除・停止。

手順はすべて `skills/scheduler/SKILL.md` に従う。要点:

1. 頻度語から cron 候補を出す: `node "${CLAUDE_PLUGIN_ROOT}/scripts/schedule-spec.js" cron "<頻度語>"`。
2. 何を定期実行するかをテンプレ（`skills/scheduler/references/job-templates.md`）から選ぶ。
3. `mcp__scheduled-tasks__create_scheduled_task` で **自己完結プロンプト** を登録（taskId は `belta-wf-<用途>`）。
4. 索引 `~/.belta/scheduler/JOBS.md` に記録する。

> 定期ジョブはこのアプリを開いている間に動く。閉じている間に実行時刻が来たら、次回起動時にまとめて実行される（利用者にその旨を伝える）。`mcp__scheduled-tasks` が使えない環境では `CronCreate(durable)` か手動運用へ縮退する（スキル内で分岐）。
