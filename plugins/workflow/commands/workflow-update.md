---
description: このエージェント自身に新しいバージョンがあるかを確認し、承認を得て最新へ更新する。自動更新が効かない環境でも確実に更新を届けるための入口。
argument-hint: ""
model: sonnet
---

<!--
model: sonnet — mid ティア。「確認 → 承認 → 2 コマンド代行 → 再起動案内」の定型処理だが、
失敗時に steps の error を読んで原因を切り分ける判断が要るため light ではなく mid を下限とする。
ティア定義は skills/workflow/references/model-tiers.md（モデル名を書く唯一の場所）。
-->

# /workflow-update — エージェント自身の更新

`plugin-update` スキル（`skills/plugin-update/SKILL.md`）を起動する入口コマンド。手順はすべてそのスキルに従う。要点：

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/update-check.js"` で確認（決定的・読み取り専用・fail-open）。
2. `update_available: false` なら「すでに最新です（v<installed>）」で終了。`ok: false` なら `message` を噛み砕いて伝え、`manual_commands` を提示して終了。
3. 更新があれば `AskUserQuestion` で承認を取る（**サイレント更新はしない**）。バージョンと「更新後に開き直しが必要」を必ず添える。
4. 承認後 `node "${CLAUDE_PLUGIN_ROOT}/scripts/update-check.js" --apply` を実行（`claude plugin marketplace update` → `claude plugin update ... --scope local` を専用フォルダで代行）。
5. 成功したら **Claude Code を閉じて専用フォルダを開き直す**よう必ず案内する。生成済みの成果物（`/avatar`・`/usage`・`/report`）は再実行するまで古いままである点も添える。
6. 失敗したら `failed_step` を見て、手動の 2 コマンドをコードブロックで提示する。

> **なぜ手動確認が必要か**: Claude Code の自動更新（marketplace の `autoUpdate`）は既知バグで機能しないため、放っておくと古いバージョンのまま残る。起動時の更新通知（`hooks/session-start.js` の (E)）は「更新が**適用された後**」に出るもので、「更新が**ある**」ことは知らせない。詳細と罠は `plugin-update` スキルの Gotchas を参照。
