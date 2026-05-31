---
description: Belta ワークフローエージェントの初回セットアップ（氏名・部署・メール収集 + MCP 4 ツール OAuth 接続）。所要約 5 分。
model: sonnet
---

<!--
model: sonnet — オンボーディングは「5 問収集 + profile.md 生成」が主体の定型処理のため
セッション既定（Opus 等）より安価なモデルに固定する。ただし Step 4（権限スクリプト実行）と
MCP 接頭辞のトラブルシュートで一定の判断が要るため、haiku ではなく sonnet を下限とする。
さらにコストを詰めたい場合は haiku に変更可（初回 OAuth/権限の取り回しが弱くなる点に注意）。
-->


# /workflow-setup — 初回セットアップ

このコマンドは Belta ワークフローエージェントの **初回オンボーディング**です。インストール後の最初のセッションでは `SessionStart` フック（`hooks/session-start.js`）が自動でこの手順の実行を促します。手動で再実行することもできます。

すでに `~/.belta/.onboarded` が存在する場合は「セットアップ済みです。やり直す場合はその旨を伝えてください」と確認してから進めてください。

## ゴール

1. 利用者プロフィール（氏名・部署・主要業務・機密度・メール）を `~/.belta/profile.md` に保存する
2. MCP 4 ツール（Notion / Slack / Google Drive / GitHub）の OAuth 接続を案内・検証する
3. 完了したら `~/.belta/.onboarded` を作成し、once-only 判定を成立させる

## 手順

### Step 1. 5 問オンボーディング（対話で 1 問ずつ聞く）

一度に全部聞かず、1 問ずつ簡潔に確認してください。**次の 5 項目はすべて必須**で、1 つでも欠けたまま Step 2 に進んではいけません。

1. **お名前**
2. **部署**
3. **主な業務**（3 つまで）
4. **扱う情報の機密度**（公開 / 社外秘 / 極秘）
5. **接続したい MCP ツール**（Notion / Slack / Google Drive / GitHub のうち複数可）

**メールアドレス**は `userEmail` コンテキスト（例: `system-bot@belta.co.jp`）を初期値として提示し、「このアドレスでよいですか？」と確認します。違う場合は訂正してもらってください。

> **必須ゲート（途中で打ち切らない）**: `AskUserQuestion` ツールは 1 回で最大 4 問までしか出せないため、上記 5 項目を 1〜2 問ずつに分けて**複数回**呼び出し、5 項目すべての回答（＋メール確認）が揃ってから Step 2 へ進むこと。氏名・部署だけ聞いて Submit するのは誤り。最後に取得した 5 項目を箇条書きで読み上げ、欠けが無いことを利用者に確認してから次へ進む。

### Step 2. `.belta` 初期化 + プロフィール保存

まず個人データ領域 `~/.belta/`（`notes/` `inbox/` `todos/` と機械可読設定 `config.yaml`）を初期化します。次を実行（Node.js 実装、Mac / Windows 両対応。atomic write + POSIX では 0o600。冪等で既存値は壊しません）：

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/belta-init.js" init --owner-email <メール> --confidentiality <公開|社外秘|極秘>
```

- `config.yaml` には `owner_email` / `confidentiality` / 自動化機能のフラグ（rule/agent/skill）が入る。後から `belta-init.js set <key> <value>` で更新できる。
- ベースを変えたい場合は `--dir <path>`。既定はホームの `.belta`（POSIX: `$HOME` / Windows: `%USERPROFILE%`）。

次に、収集内容を `~/.belta/profile.md`（人間可読の正本）に Write ツールで書き込みます（ディレクトリは初期化済み）。フィールド定義は [references/profile-template.md](../skills/workflow/references/profile-template.md) を参照。

```markdown
---
owner_name: <氏名>
owner_email: <メール>
department: <部署>
confidentiality: <公開|社外秘|極秘>
created_at: <YYYY-MM-DD>
---

## 主要業務
- <業務1>
- <業務2>
- <業務3>

## 接続ツール
- <選択したツール一覧>
```

> `~/.belta/` は `.gitignore` で除外済み。個人データはリポジトリにコミットしないこと。

### Step 3. MCP 4 ツール接続（OAuth ベース・PAT/API キー手動コピペ不要）

Step 1 で選んだツールのみ案内すればよい。

| ツール | 認証方式 | 利用者の操作 | 検証 |
| --- | --- | --- | --- |
| Notion | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Notion を認可 | `/mcp` で列挙確認 |
| Slack | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Slack を認可 | `/mcp` で列挙確認 |
| Google Drive | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Google Drive を認可 | `/mcp` で列挙確認 |
| GitHub | `gh` CLI device flow OAuth | `node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-gh.js"` で導入確認・自動導入 → `gh auth login --web` を 1 コマンド実行 | `gh auth status` で `Logged in to github.com` を確認 |

- **前提**: claude.ai の Max / Team / Enterprise プラン契約済み。
- GitHub のみ MCP サーバを置かず `gh` CLI を Bash 経由で直接利用する（監査経路の一元化 + 操作の最小化）。
- `gh` 未導入なら、まず `node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-gh.js"` を実行する。OS 標準パッケージマネージャ（macOS: Homebrew / Windows: winget）で自動導入を試み、結果を JSON（`ok` / `installed` / `message`）で返す。導入済みなら何もしない冪等動作。自動導入できない環境では `message` の手動導入手順を案内する。
- ブラウザ操作系が未インストールの場合はその旨を案内する。

### Step 4. permission allowlist の適用（フォールバック）

このプラグインは権限ルール（allow / ask / deny）を同梱の `.claude/settings.json` で配布する。プラグイン同梱 settings がインストール先に自動マージされる環境ではこのステップは不要だが、マージが効かない環境向けに**利用者の settings.json へ冪等マージする**フォールバックを用意している。

次を実行して適用する（Node.js 実装、Mac / Windows 両対応。既存設定は保持し、重複追加しない）：

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/apply-permissions.js"
```

- 適用先は**プラグインを有効化したスコープに自動で揃う**（既定）。project スコープで入れたフォルダで実行すれば project の `.claude/settings.json` に、user（グローバル）で入れていればホームの `.claude/settings.json`（POSIX: `$HOME` / Windows: `%USERPROFILE%`）に適用される。
- 明示したい場合は `--scope user|project|local`、特定ファイルに入れるなら `--target <path>` を渡す（優先順は `--target` > `--scope` > 自動判定）。
- 事前に差分だけ見たい場合は `--dry-run` を付ける。
- 適用後、`Bash(rm -rf *)` が deny、書き込み系（Slack 送信・PR 作成等）が ask、読み取り系（`gh pr list` 等）が allow になることを確認する（[references/security-policies.md](../skills/workflow/references/security-policies.md) §6）。

> **MCP 接頭辞の注意**: `.claude/settings.json` の MCP ルールは `mcp__claude_ai_<Service>__*` を前提にしている。`/mcp` で列挙される実名が異なる場合は、その接頭辞に合わせて settings.json を調整する。PII 検知フック（`hooks/pre-tool-use.js`）は接頭辞に依存しないサフィックス判定なので、書き込み系の機密遮断はこの調整に関わらず機能する。

### Step 4.5. marketplace 自動更新の有効化（推奨）

プラグインを更新（作者が push + version up）したぶんを、利用者が手動更新せずに **Claude Code 起動時へ自動で届く**ようにする。次を実行（Node.js 実装、Mac / Windows 両対応。既存設定は保持し冪等）：

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/apply-auto-update.js"
```

- 利用者の settings.json の `extraKnownMarketplaces.<marketplace>` に `autoUpdate: true` を冪等マージする（auto-update の正規の保存先。TUI の「Enable auto-update」と同じ場所）。**権限（`permissions`）には一切触れない**ので Step 4 とは別物。
- marketplace 名と GitHub repo は同梱の `marketplace.json` から自動取得する。適用先は Step 4 と同じスコープ（自動判定／`--scope`／`--target`）。事前確認は `--dry-run`。
- 自動更新を望まない利用者には、このステップを飛ばしてよい旨を伝える（後から `/plugin` → Marketplaces → Enable auto-update でも有効化できる）。
- **補足（作者向け）**: auto-update は「新しい版があれば取得」する仕組みのため、作者が修正時に `plugin.json` と `marketplace.json` の `version` を上げて push しないと利用者側に更新が届かない点に注意。

### Step 5. 完了処理（once-only 確定）

すべて完了したら state file `<home>/.belta/.onboarded` を作成します。これにより次回以降のセッションで `SessionStart` フックがセットアップ案内を再注入しなくなります。

state file は **Write ツールで空ファイルとして作成** してください（親ディレクトリが無ければ作成されます）。`mkdir` / `touch` 等の POSIX コマンドは Windows で動かないため必須経路に使いません。ホームディレクトリはシェルの `~` 展開に頼らず、環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決します。

最後に「セットアップ完了。以降は普通に話しかければ Notion / Slack / GitHub / Google Drive に自動で振り分けます」と案内して終了。

## 注意

- ユーザーが別の用件を明確に依頼している場合は、その用件を優先し、セットアップは後回しでよい旨を伝える（`~/.belta/.onboarded` が無い限り次回起動時に再案内される）。
- フックはあくまで「案内の自動起動」であり、ツール接続はユーザー自身の OAuth 認可操作が必要。
