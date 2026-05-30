# belta-workflow-agent（Belta 業務アシスタント）

**ひとことで言うと** — いつもの言葉で「これやっといて」と頼むだけで、4 つのアプリ（Notion・Slack・GitHub・Google Drive）への入力や整理を代わりにやってくれる、あなた専用のアシスタントです。

たとえるなら、**4 つの道具を使い分けられる優秀な秘書**。「どのアプリを開いて、どこに何を入力するか」を、あなたが考えなくてよくなります。

> 例：
> - 「来週の打ち合わせメモを整理して」と話しかける → メモアプリ（Notion）に自動で整理して保存
> - 「インフラチームに共有して」と話しかける → チャット（Slack）に自動で投稿

> **いまの状態**：お試し中の段階です。情報システム部の 2〜3 名が実際に使って動作を確認しています（2026-06-14 まで）。ここで集めた「どれだけ仕事が楽になったか」の記録を、2026-06-10 の経営会議に提出します。

---

## できること

話しかけた内容に合わせて、行き先のアプリを自動で選んで処理します。

| あなたが話しかけること | アシスタントがやること |
| --- | --- |
| 「来週の MTG メモを整理して」 | メモアプリ（Notion）にまとめる |
| 「インフラチームに共有して」 | チャット（Slack）に投稿する |
| 「先週の作業をまとめて」 | 開発記録（GitHub）から要約する |
| 「議事録 PDF を取り込んで」 | ファイル置き場（Google Drive）から読み込む |

さらに、**使えば使うほどあなたに合わせて賢くなります**。

- 同じ言い方で何度か直すと、「次はこうしますね」と覚えてくれます。
- よく頼む種類の仕事は、その仕事の「専門アシスタント」が自動で用意されます。

---

## 使い始める（3 ステップ・約 5 分）

### ステップ 1：道具を入れる

下のコマンドを 1 回実行します（情シス担当が代行することもできます）。

```
/plugin marketplace add belta-group/belta-workflow-agent
/plugin install workflow@belta-workflow-agent
```

### ステップ 2：自己紹介に答える

道具を入れたあと、**最初に画面を開いたときに、案内が自動で始まります**。
氏名・部署・メール・扱う情報の重要度・つなぎたいアプリを、対話形式で聞かれるので答えるだけです。

> もし案内が出ないときは `/workflow-setup` と打てば、いつでも始められます。
> 一度終えれば次からは自動で始まりません。途中でやめた場合は、次に開いたときにまた続きから案内されます。

### ステップ 3：4 つのアプリと「つなぐ」許可をする

パスワードを入力したり、難しい接続キーをコピーしたりする必要はありません。
各アプリの「許可」ボタンを押すだけで安全につながります（この仕組みを OAuth と呼びます）。

| アプリ | つなぎ方 |
| --- | --- |
| Notion | claude.ai の設定画面 → Connectors → Notion を「許可」 |
| Slack | claude.ai の設定画面 → Connectors → Slack を「許可」 |
| Google Drive | claude.ai の設定画面 → Connectors → Google Drive を「許可」 |
| GitHub | `gh auth login --web` というコマンドを 1 回実行 |

> **必要なもの**：claude.ai の Max / Team / Enterprise いずれかの契約（本リポジトリは Max 契約を前提に作られています）。

これで準備は完了です。あとは `/workflow` と打って話しかけるだけです。

---

## 使い方の例

```
> /workflow

アシスタント: はじめまして。まず簡単に教えてください。
  1. お名前
  2. 部署
  3. 主な業務（3 つまで）
  4. 扱う情報の重要度（公開 / 社外秘 / 極秘）
  5. つなぎたいアプリ（Notion / Slack / GitHub / Google Drive）
```

このあとは、ふつうに話しかけるだけ。内容に応じて、自動で行き先のアプリが選ばれます。

---

以下は、導入や保守を担当する **情報システム部・技術担当者向け** の詳細です。利用するだけの方は読まなくて構いません。

## 技術メモ（担当者向け）

### しくみの要点

- 初回セットアップは `SessionStart` フックで once-only 起動（Claude Code にインストール時フックが無いための代替手段）。完了時に `~/.belta/.onboarded` が作成され、以降は自動案内されない。未完了のうちは毎回のセッション開始時に再案内される（やり残しの自己修復）。プラグイン導入時点で既に開いているセッションでは発火しないため、新しいセッションで案内される。
- 認証はすべて OAuth ベース（PAT・API キーの手動コピペ不要）。Notion / Slack / Google Drive は claude.ai Connector OAuth、GitHub は `gh` CLI の device flow OAuth。
- GitHub のみ MCP サーバを置かず、`gh` CLI を Bash 経由で直接呼び出す（理由：監査経路の一元化 + ユーザ向け操作の最小化）。
- パーソナライズの内部動作：
  - **発話 → ルール蓄積**：「次回からは」「毎回」等のフレーズや同じ訂正 2 回検出で、`.belta/rules/` にルールを提案・蓄積。
  - **業務領域 → 専用エージェント生成**：同じ業務領域（例: Notion DB 設計 / 営業案件レビュー）が 5 営業日以内に 2 回出現すると、専用 Claude Code subagent を `~/.belta/agents/<slug>.md` に生成し、`~/.claude/agents/` に symlink して標準 `Agent` ツールから呼び出し可能にする。

### 構成

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
│           ├── hooks.json         ← フック登録（SessionStart / PreToolUse / Stop）
│           ├── session-start.js   ← 初回セットアップ自動起動（once-only、Node.js / Mac・Windows 両対応）
│           ├── pre-tool-use.js    ← PII / 機密検知（Node.js / Mac・Windows 両対応）
│           └── token-usage.js     ← トークン使用量ログ（Stop、~/.belta/audit/tokens/ に集計。Node.js / Mac・Windows 両対応）
├── .gitleaks.toml
├── .github/workflows/secret-scan.yml
├── scripts/
│   └── aggregate-token-usage.js  ← トークン使用量の集計（Phase 0 実測データ用。--md / --json 出力）
└── docs/
    ├── background.md              ← Phase -1 背景
    └── tasks.md                   ← 実装チェックリスト
```

### セキュリティ

ひとことで言うと、**「機密情報がうっかり外に出ないよう、何重もの見張りを置いている」** という設計です。

- **外部送信前検知**: `hooks/pre-tool-use.js` がマイナンバー / クレジットカード / メールアドレス一括 / 「マル秘」「社外秘」/ パスワードリテラルを検知し、書き込み系（Slack / Notion / Google Drive の `send|create|update`、`gh issue|pr|release|gist create`、`curl|wget|http`）をブロック。
- **Git 層検知**: `.gitleaks.toml` + GitHub Actions（`secret-scan.yml`）が PR / push 時にスキャン。
- **permission allowlist**: `plugin.json` で読み取り系は allow、書き込み系は ask、`Bash(rm -rf *)` / `Bash(sudo *)` / `Bash(git push --force *)` / `Bash(gh repo delete *)` 等は deny。
- **個人データの物理除外**: `.belta/` は `.gitignore` で除外。
- **平文認証情報を持たない**: API キーや PAT のローカル平文保存は行わない。Notion / Slack / Google Drive は claude.ai Connector 側の OAuth 保管庫、GitHub は macOS keychain。

#### 漏洩発生時の手順

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
