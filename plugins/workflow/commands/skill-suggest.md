---
description: 業務に効く既製スキルを能動的に提案する。直近の作業（notes）とキュレート済みカタログを照合し、あなたの部署・困りごとに合うスキルを探して提案・（信頼ソースに限り）導入する。
argument-hint: "[--department <slug>] [--category <c>] [<困りごと>]"
---

# /skill-suggest — 業務に効くスキルの能動提案

`skill-suggestion` スキル（`skills/skill-suggestion/SKILL.md`）を **能動的に** 起動する入口コマンド。反復検知（トリガ A/B/C）を待たず、利用者の「いま」の業務に合うスキルをこちらから探して提案する。

引数（任意）:

- `--department <slug>` — 部署 slug を明示（例 `info-system`）。省略時は `~/.belta/profile.md` の `department` を既定に使う。
- `--category <c>` — `document` / `spreadsheet` / `slides` / `automation` / `authoring` / `discovery` に絞る。
- `<困りごと>` — 「PDF から表を抜くのが毎回手作業」等の自由記述。能動ヒアリングの起点に使う。

手順はすべて `skills/skill-suggestion/SKILL.md` に従う（このコマンドは入口、判断・提案ロジックはスキル本体）。**利用者に見せる文面はすべて日本語で出力する**。要点:

1. 部署が未指定なら `~/.belta/profile.md` の `department` を Read で取得し既定にする。困りごとが未指定なら 1 問だけ `AskUserQuestion` で「いちばん手間に感じている繰り返し作業」を尋ねる（一度に詰め込まない）。
2. カタログ照合（決定的・オフライン・読み取り専用）:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/catalog-scan.js" --department <slug> [--category <c>] --available-only
   ```

   返る JSON の `candidates`（`status` / `cooldown_until` / `auto_installable` / `required_permissions` を含む）を提案候補にする。`catalog_available:false` なら手順 4 の find-skills フォールバックへ。
3. 直近作業との照合（重み付け・読み取り専用）:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/notes-scan.js" --days 7
   ```

   `top_requests`（繰り返している依頼）と困りごとに合致する候補を優先する（トリガ A の能動版）。手元の道具で既に賄えるもの（同等の利用可能スキルがある）は提案せず利用案内に切り替える（SKILL.md Step 1）。
4. カタログにヒットが無い・カタログ外の能力が要るときだけ、`find-skills` でネットワーク探索する（SKILL.md Step 2）。
5. 提案は `AskUserQuestion` で 1 候補ずつ。**提供元（source）・要求権限（required_permissions）・用途（why）を必ず併記**する。allowlist 内（`auto_installable:true`）でも **サイレント導入はしない**（必ず確認を取る）。
6. 承認なら `/plugin install <skill>@<marketplace>`（Claude Code 標準・OS 非依存）で導入し、`~/.belta/skills/SKILLS.md` に `installed` を記録。却下なら `rejected` を記録（同一スキル 3 回連続却下で 14 営業日冷却。詳細は SKILL.md Step 5）。allowlist 外は提案のみに留め、手動導入の注意点（`references/skill-allowlist.md` の目視確認チェックリスト）を案内する。

> 走査対象 `~/.belta/`（notes / profile / SKILLS.md）は「あなたのパソコン内の個人フォルダ」。リポジトリには出ない。パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。両ヘルパー（catalog-scan / notes-scan）は読み取り専用・fail-open で、失敗してもセッションを妨げない。
