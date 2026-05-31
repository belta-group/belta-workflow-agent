# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Belta 社内向けワークフロー自動化エージェント（Claude Code Plugin）。利用者向けの概要は [README.md](README.md)、フェーズ背景や実装チェックリストは [docs/tasks.md](docs/tasks.md) を参照。

## 実装ルール（必読）

プラグイン全体に適用される実装ルール。実装・レビュー時に必ず遵守すること。**最重要は「Mac / Windows 両対応」**で、OS 依存コマンド（`mkdir -p` / `cp` / `ln -s` / `cat` 等）を必須経路に置かず、Node.js の `fs` API か Claude Code 標準ツールに寄せる。

@.claude/rules/cross-platform.md

### 利用者向けドキュメント（docs/）の執筆方針

`docs/` 配下の利用者向けページを作成・改訂するときは、**非エンジニアにも一読で伝わる**ことを必須要件とする。結論先出し・認知負荷の最小化・メタファー活用・専門用語の翻訳（「日常語（専門用語）」形）・ピラミッド構造の 5 原則を守り、統一メタファーと用語グロッサリーで表記をブレさせない。既存の `##` 見出し（アンカー）を壊さず、改訂後は `npm run docs:build` で dead-link を検証すること。

@.claude/rules/doc-writing.md

## リポジトリ構成

このリポジトリは 2 つの独立した部分から成る。

- **`plugins/workflow/`** — プラグイン本体（配布物）。`.claude-plugin/plugin.json` がマニフェスト。`.claude-plugin/marketplace.json`（リポジトリルート）からこのディレクトリを参照している。
- **`docs/`** — VitePress 製の利用者向けドキュメントサイト（プラグインの動作とは独立）。`docs/.vitepress/dist/` と `docs/node_modules/` は生成物。

実装を変更するのはほぼ常に `plugins/workflow/` 配下。`scripts/aggregate-token-usage.js`（ルート）は Phase 0 の実測データ集計用の独立 CLI。

## アーキテクチャ（plugins/workflow）

ユーザの業務発話を受け、Notion / Slack / GitHub / Google Drive のうち最適なツールへ分岐する。中核は **フック・スキル・コマンド** の 3 層。

### フック（`hooks/hooks.json` で登録、すべて Node.js 単一実装）

- **`session-start.js`（SessionStart）** — 初回オンボーディングの once-only 自動起動。Claude Code にインストール時フックが無いための代替。`~/.belta/.onboarded` があれば無出力で終了、無ければ `additionalContext` で `/workflow-setup` へ誘導する。
- **`pre-tool-use.js`（PreToolUse）** — 外部送信前の PII / 機密検知。`hooks.json` の matcher で対象ツール（`Bash` / Slack・Notion・GDrive の書き込み系）に絞ったうえで、コード内でも書き込み系か再判定する。マイナンバー（12桁）・クレジットカード（Luhn）・メール一括（ユニーク5件以上）・機密ラベル・パスワードリテラルを検知すると `permissionDecision: "deny"` でブロック。読み取り系・非該当は無出力で素通しし通常 permission に委ねる。
- **`token-usage.js`（Stop）** — トランスクリプトの usage を集計し、**セッション 1 ファイル**（`~/.belta/audit/tokens/<session_id>.json`）に atomic に**上書き**保存（append しないので二重計上しない）。`scripts/aggregate-token-usage.js` がこの配下を合算する。
- **`notes-record.js`（Stop）** — トランスクリプトから「その日の利用者依頼」を機械抽出し、`~/.belta/notes/<YYYY-MM-DD>.md` に **1 セッション 1 行で upsert**（`[session:<id>]` 行を在れば置換／無ければ追記。LLM が書いた他行は保全）。反復検知（`rule-learning` / `agent-learning`）の土台となる notes 履歴を、LLM 任せの自動記録が漏れても確定的に残すための下支え。あわせて保持期間（既定 14 日・`config.yaml` の `notes_retention_days`、下限 7）を過ぎた**日次ログのみ**削除する（トピックノート `kebab-case.md` は残す）。

**フックの鉄則**: 例外時は決してセッションを妨げない（`exit 0` + 無出力 / fail-open）。`§7` 参照。

### スキル（`skills/*/SKILL.md`）

`workflow`（メイン分岐）/ `notion-schema`（DB 設計知識）/ `rule-learning`（発話→ルール自動蓄積）/ `agent-learning`（業務領域→専用 subagent 自動生成）/ `skill-suggestion`（新スキル提案）。`description` の発話トリガーで発火する。

### コマンド（`commands/*.md`）

`/workflow`（エントリポイント、`workflow` スキルを呼ぶ）/ `/workflow-setup`（5問オンボーディング → `scripts/belta-init.js` 実行 → `~/.belta/.onboarded` 作成）。

### スクリプト（`scripts/*.js`）

`belta-init.js`（`~/.belta/` 構造と `profile.json` 雛形を冪等生成）/ `apply-permissions.js`（同梱 `.claude/settings.json` の permissions を、プラグインが有効化されているスコープと同じ settings.json（既定は自動判定。`--scope user|project|local` / `--target` で上書き可）へ重複なしマージするフォールバック）/ `apply-auto-update.js`（marketplace の自動更新を先回りで有効化。利用者 settings.json の `extraKnownMarketplaces.<marketplace>` に `autoUpdate: true` を冪等マージする。marketplace 名/repo は同梱 `marketplace.json` から自動取得、適用先スコープは `apply-permissions.js` と同一ロジック。**`permissions` には触れない**＝権限境界の権威ソースとは別物）。

### ユーザデータと権限

- 実行時の個人データはすべて利用者ホームの **`~/.belta/`** 配下（`profile.json` / `rules/` / `agents/` / `audit/`）に置く。リポジトリには含めない。
- 権限境界の**単一の権威ソースは `plugins/workflow/.claude/settings.json` の `permissions`**（読み取り=allow / 書き込み=ask / 破壊的操作=deny）。`plugin.json` には permissions フィールドを置かない（プラグインマニフェストの機能ではないため）。プラグイン同梱 settings が自動マージされない環境では `apply-permissions.js` がこの権威ソースを利用者の settings.json へ反映する。**権限を変えるときはこの 1 ファイルだけを編集する。**
- 認証は全て OAuth ベース（PAT / API キーの平文保存をしない）。GitHub のみ MCP を置かず `gh` CLI を Bash 経由で呼ぶ。

## 検証・コマンド

このプラグインに従来型のビルド／テストランナーは無い。変更後の検証は以下で行う。

```bash
# フック・スクリプトの構文チェック（OS 依存処理を書いたら必須）
node --check plugins/workflow/hooks/pre-tool-use.js

# フックの手動実行（標準入力に擬似ペイロードを渡して挙動確認）
echo '{"tool_name":"mcp__slack__send_message","tool_input":{"text":"..."}}' | node plugins/workflow/hooks/pre-tool-use.js

# トークン使用量の集計（--md / --json、--since / --until）
node scripts/aggregate-token-usage.js --md

# ドキュメントサイト（docs/ 配下で）
cd docs && npm install && npm run docs:dev   # ローカルプレビュー
npm run docs:build                            # ビルド
```

OS 依存の処理を追加したら、`cross-platform.md §8` に従い合成シナリオで両 OS 分岐（symlink 成功 / コピーフォールバック、ファイル有無、異常入力）を最低限テストする。

## セキュリティ層

機密漏洩を多層で防ぐ設計。変更時はどの層に手を入れているか意識する。

1. **実行時検知** — `hooks/pre-tool-use.js`（上記）。
2. **Git 層検知** — `.gitleaks.toml` + GitHub Actions `secret-scan.yml`（PR / push 時スキャン）。`.gitleaks.toml` の allowlist には誤検知回避のため `.github/` が含まれる。
3. **権限 allowlist** — 同梱 `.claude/settings.json` の deny（`rm -rf` / `sudo` / `git push --force` / `gh repo delete` 等）。
4. **物理除外** — `~/.belta/` は利用者ホーム側、`.gitignore` でも保護。
