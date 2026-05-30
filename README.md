# belta-workflow-agent

Belta 社内向けワークフロー自動化エージェント（Claude Code Plugin）。

`/workflow` を実行すると、5 問のオンボーディングで利用者の部署・主要業務・機密度を把握し、以降の発話を **Notion / Slack / GitHub / Google Drive** の最適ツールに自動分岐します。

> **ステータス**: Phase -1（社内ドッグフード）／2026-06-14 までに情シス 2〜3 名で動作確認、2026-06-10 経営承認会議の添付資料を取得。

## インストール

```
/plugin marketplace add belta-group/belta-workflow-agent
/plugin install workflow@belta-workflow-agent
```

その後、初回のみ 4 ツール接続をセットアップします（所要 5 分）。

```
/workflow-setup
```

認証は **すべて OAuth ベース**（PAT・API キーの手動コピペ不要）：

| ツール | 認証 | 利用者の操作 |
| --- | --- | --- |
| Notion | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Notion 認可 |
| Slack | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Slack 認可 |
| Google Drive | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Google Drive 認可 |
| GitHub | `gh` CLI device flow OAuth | `gh auth login --web` 1 コマンド |

> **前提**: claude.ai の Max / Team / Enterprise プラン契約済（本リポは Max プラン前提で構築）。

GitHub のみ MCP サーバを置かず、`gh` CLI を Bash 経由で直接呼び出します（理由：監査経路一元化 + ユーザ向け操作の最小化）。

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

さらに使うほど **個別のパーソナライズ** が進みます：

- **発話 → ルール蓄積**: 「次回からは」「毎回」等のフレーズや同じ訂正 2 回検出で、`.belta/rules/` にルールを提案・蓄積
- **業務領域 → 専用エージェント生成**: 同じ業務領域（例: Notion DB 設計 / 営業案件レビュー）が 5 営業日以内に 2 回出現すると、専用 Claude Code subagent を `~/.belta/agents/<slug>.md` に生成し、`~/.claude/agents/` に symlink して標準 `Agent` ツールから呼び出し可能にする

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
│       │   ├── rule-learning/     ← 発話 → ルール自動蓄積
│       │   └── agent-learning/    ← 業務領域 → 専用 subagent 自動生成
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

- **外部送信前検知**: `hooks/pre-tool-use.sh` がマイナンバー / クレジットカード / メールアドレス一括 / 「マル秘」「社外秘」/ パスワードリテラルを検知し、書き込み系（Slack / Notion / Google Drive の `send|create|update`、`gh issue|pr|release|gist create`、`curl|wget|http`）をブロック。
- **Git 層検知**: `.gitleaks.toml` + GitHub Actions（`secret-scan.yml`）が PR / push 時にスキャン。
- **permission allowlist**: `plugin.json` で読み取り系は allow、書き込み系は ask、`Bash(rm -rf *)` / `Bash(sudo *)` / `Bash(git push --force *)` / `Bash(gh repo delete *)` 等は deny。
- **個人データの物理除外**: `.belta/` は `.gitignore` で除外。
- **平文認証情報を持たない**: API キーや PAT のローカル平文保存は行わない。Notion / Slack / Google Drive は claude.ai Connector 側の OAuth 保管庫、GitHub は macOS keychain。

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
