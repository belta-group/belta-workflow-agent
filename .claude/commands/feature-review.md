---
description: git 差分（既定 main 比較）から追加機能を抽出し、5観点でレビューする開発者ツール
argument-hint: "[--current | <branch> | --pr <n>]"
---

# /feature-review — 差分の多観点レビュー（開発者ツール）

`feature-review` スキル（`.claude/skills/feature-review/SKILL.md`）を起動する入口コマンド。このリポジトリ自身の git 差分から「今回追加・変更された機能」を抽出し、**セキュリティ／テスト網羅性／単一責任／クロスプラットフォーム＋ドキュメント整合／BELTA 固有規約**の5観点で診断する。コミット前のセルフレビュー用。

引数（任意）:

- （なし）— `main` との分岐点以降のコミット＋未コミット＋未追跡（新規）ファイルを対象にレビュー。
- `<branch>` — 指定ブランチとの差分を対象。
- `--current` — 直前コミット以降＋未コミット＋未追跡を対象。
- `--pr <n>` — GitHub PR #n の差分を対象（`gh pr diff`）。

走査の実体は `node .claude/skills/feature-review/scripts/diff-scan.js`（読み取り専用・JSON 出力）。手順はすべて `.claude/skills/feature-review/SKILL.md` に従う。**レビュー結果はすべて日本語で、結論先出し・重大度（🔴要修正 / 🟡要確認 / 🟢提案）付きで出力する。**

> これは配布物（`plugins/workflow/`）ではなく開発ツール。レビューは指摘のみで、ファイルの自動修正・PR コメント投稿・git の書き込み操作はしない。
