# belta-workflow-agent

Belta 社内向けワークフロー自動化エージェント（Claude Code Plugin）。

`/workflow` を実行すると、5 問のオンボーディングで利用者の部署・主要業務・機密度を把握し、以降の発話を **Notion / Slack / GitHub / Google Drive** の最適ツールに自動分岐します。

> **ステータス**: Phase -1（社内ドッグフード）／2026-06-14 までに情シス 2〜3 名で動作確認、2026-06-10 経営承認会議の添付資料を取得。

## インストール

```
/plugin marketplace add belta-group/belta-workflow-agent
/plugin install workflow@belta-workflow-agent
```

その後、初回のみ MCP 4 ツール接続をセットアップします。

```
/workflow-setup
```

## 使い方

```
> /workflow

エージェント: はじめまして。まず簡単に教えてください。
  1. お名前
  2. 部署
  3. 主な業務（3 つまで）
  4. 扱う情報の機密度（公開 / 社外秘 / 極秘）
  5. 接続したい MCP ツール（Notion / Slack / GitHub / Google Drive）

→ ~/.belta/profile.md と .belta/ が生成される（初回のみ）
```

以降の発話は内容に応じて自動でツールに振り分けられます。例：

- 「来週の MTG メモを整理して」→ Notion
- 「インフラチームに共有して」→ Slack
- 「先週の PR をまとめて」→ GitHub
- 「議事録 PDF を取り込んで」→ Google Drive

## 構成

```
belta-workflow-agent/
├── .claude-plugin/
│   └── marketplace.json
├── plugins/
│   └── workflow/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── skills/
│       │   ├── workflow/          ← メインスキル
│       │   ├── notion-schema/     ← Notion DB 設計知識
│       │   └── rule-learning/     ← 自動ルール化
│       ├── commands/
│       │   ├── workflow.md
│       │   └── workflow-setup.md
│       └── hooks/
│           └── pre-tool-use.sh    ← PII / 機密検知
├── .gitleaks.toml
├── .github/workflows/secret-scan.yml
└── docs/
    ├── background.md              ← Phase -1 背景
    └── tasks.md                   ← 実装チェックリスト
```

## セキュリティ

- **MCP 送信前検知**: `pre-tool-use.sh` がマイナンバー / クレジットカード / メールアドレス一括 / 「マル秘」「社外秘」/ パスワードリテラルを検知し、Slack・Notion・curl 送信をブロック。
- **Git 層検知**: `.gitleaks.toml` + GitHub Actions（`secret-scan.yml`）が PR / push 時にスキャン。
- **permission allowlist**: `plugin.json` で `Bash(rm -rf *)` / `Bash(sudo *)` 等を deny。`mcp__slack__send_*` / `Bash(curl *)` は ask。
- **個人データの物理除外**: `.belta/` は `.gitignore` で除外。

### 漏洩発生時の手順

1. 該当ブランチを直ちに force-push で履歴を書き換え
2. GitHub の secret scanning alerts を確認
3. 該当キー / トークンを即無効化 → 再発行
4. 情シス推進担当へ報告 + `~/.belta/audit/` にインシデント記録

## ドキュメント

- 背景と目的: [docs/background.md](docs/background.md)
- 実装チェックリスト: [docs/tasks.md](docs/tasks.md)
- 詳細プラン: `~/.claude-profiles/belta/plans/dev-cc-company-snug-hammock.md`

## ライセンス

社内利用限定（UNLICENSED）。
