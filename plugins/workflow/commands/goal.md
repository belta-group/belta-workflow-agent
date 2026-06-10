---
description: 複数ステップの成果物ゴールを登録し、進捗を追跡し、セッションをまたいで完遂まで進める。引数なしで進行中ゴールの一覧と次アクションを表示。
argument-hint: "[new <ゴール>|list|resume <slug>|done <slug>|archive <slug>]"
model: inherit
---

<!--
model: inherit — ゴールのステップ分解・進捗の意味づけ・再開判断を行うため、
セッションのモデル（通常 Opus）を継承する。
走査（一覧・進捗集計・stale 検知）は scripts/goal-scan.js が決定的に担う二層構造。
-->

# /goal — 複数ステップのゴール管理

`goal` スキル（`skills/goal/SKILL.md`）を起動する入口コマンド。1 回の会話で終わらない仕事を `~/.belta/goals/<slug>.md` に永続化し、セッションをまたいで完遂まで追跡する。

引数（任意）:

- （なし）/ `list` — `node "${CLAUDE_PLUGIN_ROOT}/scripts/goal-scan.js"` を実行し、進行中ゴールの一覧（進捗 done/total・次のステップ・停滞/blocked の有無）を日本語で表示し、次のアクション（どれを再開するか・新規登録するか）を提案する。
- `new <ゴール>` — 新しいゴールを登録する（SKILL.md の Step 1: 分解 → 承認 → 永続化）。
- `resume <slug>` — 指定ゴールを再開する（SKILL.md の Step 3: 必ず `goal-scan.js --slug` で現状取得から）。
- `done <slug>` — 全ステップ完了の確認と `status: done` への更新（SKILL.md の Step 4）。
- `archive <slug>` — ゴールを中断・アーカイブする（`status: archived`。ファイルは移動しない）。

手順はすべて `skills/goal/SKILL.md` に従う。**利用者に見せる進捗報告・確認の文面はすべて日本語で出力する**。

> ゴールの保存先 `~/.belta/goals/` は「あなたのパソコン内の個人フォルダ」。リポジトリには出ない。パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。
