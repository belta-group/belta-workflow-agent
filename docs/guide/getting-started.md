# 導入手順（5 分セットアップ）

インストールから初回セットアップ完了までは **約 5 分**です。順に進めてください。

## 前提の確認

- Claude Code がインストール済みであること。
- claude.ai のプランが **Max / Team / Enterprise** のいずれかであること（Connector 利用に必要）。
- GitHub を使う場合は `gh` CLI が導入済みであること（後からでも可）。

## Step 1. プラグインをインストール

Claude Code で次の 2 コマンドを実行します。

```
/plugin marketplace add belta-group/belta-workflow-agent
/plugin install workflow@belta-workflow-agent
```

1 行目で社内マーケットプレイスを登録し、2 行目で `workflow` プラグインを導入します。

## Step 2. 初回セットアップ（自動案内）

インストール後、**新しいセッションを開始すると初回セットアップが自動で案内されます**。これは `SessionStart` フック（`hooks/session-start.js`）による once-only 起動で、Claude Code にインストール時フックが無いための代替手段です。

::: tip すでに開いているセッションでは発火しません
プラグインを入れた時点で開いていたセッションでは案内が出ません。**新しいセッションを開始**してください。
:::

手動で開始・再実行したい場合は次のコマンドを使います。

```
/workflow-setup
```

## Step 3. 5 問オンボーディング

セットアップでは、以下を **1 問ずつ**聞かれます。選択式の設問は選択 UI で答えられます。

1. **お名前**
2. **部署**（例: 情報システム部、営業部）
3. **主な業務**（3 つまで。例: Notion スキーマ設計、週次ワークフロー改善、社内問い合わせ対応）
4. **扱う情報の機密度**（**公開 / 社外秘 / 極秘** の 3 択）
5. **接続したい MCP ツール**（Notion / Slack / Google Drive / GitHub から複数選択可）

**メールアドレス**は初期値が提示されるので、合っていれば承認、違えば訂正します。

::: info 機密度はセキュリティ判断に使われます
選んだ機密度は、外部送信前の確認の厳しさ（[PII 検知フック](/guide/security#l1-pii-検知フック)の警告文脈）に反映されます。**極秘**ほど確認が厳格になります。
:::

入力内容は次の場所に保存されます（個人データ。`.gitignore` で除外済み）。

- `~/.belta/profile.md` … 人間可読のプロフィール正本（氏名・部署・機密度・主要業務・接続ツール）
- `~/.belta/config.yaml` … 機械可読の設定（`owner_email` / `confidentiality` / 自動化機能のフラグ）
- `~/.belta/notes/` `inbox/` `todos/` … 日々の記録用ディレクトリ

> パスのホームディレクトリは POSIX では `$HOME`、Windows では `%USERPROFILE%` から解決されます。

## Step 4. 4 ツールの OAuth 接続

Step 3 で選んだツールについて、OAuth 接続が案内されます。**認証はすべて OAuth ベース**で、PAT や API キーの手動コピペは不要です。

| ツール | 操作 |
| --- | --- |
| Notion / Slack / Google Drive | claude.ai → Settings → Connectors で各サービスを認可 |
| GitHub | ターミナルで `gh auth login --web` を 1 回実行 |

詳しい手順と検証方法は **[4 ツール OAuth 接続](/guide/oauth-setup)** を参照してください。

## Step 5. 権限ルールの適用（必要な場合のみ）

このプラグインは権限ルール（allow / ask / deny）を同梱の `.claude/settings.json` で配布します。多くの環境では自動マージされるため操作は不要ですが、マージが効かない環境向けに手動適用のフォールバックが用意されています。

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/apply-permissions.js"
```

- 既存の設定は保持され、重複追加はされません（冪等）。
- 事前に差分だけ確認したいときは `--dry-run` を付けます。
- 詳細は **[セキュリティと権限](/guide/security#l2-permission-allowlist)** を参照。

## 完了

すべて完了すると `~/.belta/.onboarded` が作成され、以降は初回案内が出なくなります。

> 未完了のうちは、セッション開始のたびに案内が再表示されます（やり残しの自己修復）。別の用件を先に片付けたい場合はそちらを優先して構いません。

セットアップ後は、`/workflow` で起動するか、そのまま普通に話しかければ内容に応じて 4 ツールへ自動で振り分けられます。**[基本的な使い方](/guide/usage)** へ進んでください。
