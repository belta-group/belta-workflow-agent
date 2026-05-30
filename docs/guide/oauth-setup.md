# 4 ツール OAuth 接続

Belta ワークフローエージェントは **Notion / Slack / Google Drive / GitHub** の 4 ツールと連携します。**認証はすべて OAuth ベース**で、PAT や API キーの手動コピペは不要です。平文の API キーをローカルに保管しません。

::: info 前提
claude.ai の **Max / Team / Enterprise** プラン契約済みであること（Connector 利用に必要）。
:::

## 一覧

| ツール | 認証方式 | 利用者の操作 | トークン保管先 | 検証 |
| --- | --- | --- | --- | --- |
| **Notion** | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Notion を認可 | claude.ai 側 OAuth 保管庫 | `/mcp` で列挙確認 |
| **Slack** | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Slack を認可 | claude.ai 側 OAuth 保管庫 | `/mcp` で列挙確認 |
| **Google Drive** | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Google Drive を認可 | claude.ai 側 OAuth 保管庫 | `/mcp` で列挙確認 |
| **GitHub** | `gh` CLI device flow OAuth | ターミナルで `gh auth login --web` を 1 回実行 | OS 標準資格情報ストア | `gh auth status` で確認 |

## なぜ認証が 2 系統に分かれるのか

| 系統 | 対象 | 仕組み |
| --- | --- | --- |
| **claude.ai Connector OAuth** | Notion / Slack / Google Drive | claude.ai がホストするリモート MCP サーバー。認可後、トークンは claude.ai 側に保管され、ツール実行時にサーバー内部で使われます。 |
| **gh CLI device flow OAuth** | GitHub | MCP を介さず、ローカルの `gh` CLI が OS の資格情報ストアにトークンを保管。操作は Bash 経由の `gh` コマンド直叩き。 |

**GitHub だけ MCP を置かない理由**：MCP プロセス常駐分のオーバーヘッド削減、監査を Bash ログ 1 系統に一元化、非エンジニアでも `gh auth login --web` 1 コマンドで済むこと。

---

## Notion（claude.ai Connector OAuth）

1. ブラウザで claude.ai を開く。
2. **Settings → Connectors** を開く。
3. **Notion** を選び **Connect / 認可** をクリック。
4. Notion 側のダイアログで対象ワークスペースを選び **許可** する。
5. claude.ai に戻り、Notion が「接続済み」表示になることを確認。

**検証**: Claude Code で `/mcp` を実行し、Notion 系ツール（`notion-search` / `notion-fetch` / `notion-create-*` 等）が列挙されること。

## Slack（claude.ai Connector OAuth）

1. claude.ai → **Settings → Connectors**。
2. **Slack** を **Connect / 認可**。
3. Slack の OAuth 画面で対象ワークスペースを選び **許可**。
4. claude.ai で「接続済み」を確認。

**検証**: `/mcp` で Slack 系ツール（`slack_read_*` / `slack_search_*` / `slack_send_message` 等）が列挙されること。

## Google Drive（claude.ai Connector OAuth）

1. claude.ai → **Settings → Connectors**。
2. **Google Drive** を **Connect / 認可**。
3. Google アカウントを選び、要求スコープを確認して **許可**。
4. claude.ai で「接続済み」を確認。

**検証**: `/mcp` で Google Drive 系ツール（`search_files` / `read_file_content` / `list_recent_files` 等）が列挙されること。

## GitHub（`gh` CLI device flow OAuth）

MCP ではなくローカルの `gh` CLI を使います。未導入なら先にインストールしてください。

- macOS: `brew install gh`
- Windows: `winget install GitHub.cli`（または公式インストーラ）

手順：

1. ターミナルで次を実行：

   ```
   gh auth login --web
   ```

2. プロンプトに従い `GitHub.com` → プロトコル `HTTPS` を選択。
3. 表示された **ワンタイムコード**を控え、`Enter` でブラウザを開く。
4. ブラウザでコードを入力し **Authorize** する。
5. ターミナルに `Logged in as <ユーザー名>` が出れば完了。

**検証**: `gh auth status` を実行し `Logged in to github.com` と表示されること。

---

## 接続検証（まとめ）

| 対象 | コマンド | 期待結果 |
| --- | --- | --- |
| Notion / Slack / Google Drive | `/mcp` | 認可した各サービスのツール群が列挙される |
| GitHub | `gh auth status` | `Logged in to github.com as <user>` |

::: tip ツール名のプレフィックスについて
`/mcp` に出るツール名のプレフィックス（`mcp__claude_ai_Notion__*` 等）は Connector の登録構成によって変わることがあります。**サービス名で該当ツールが見えていれば接続成功**です。確信が持てないときは `/mcp` で実際の一覧を確認してください。
:::

## 認証情報の保管（セキュリティ）

| 系統 | 保管先 | ローカル平文 |
| --- | --- | --- |
| Notion / Slack / Google Drive | claude.ai 側 OAuth 保管庫 | 無し |
| GitHub | OS 標準資格情報ストア（macOS: keychain、Windows: 資格情報マネージャー 等） | 無し（OS ストアが暗号化保管） |

- リポジトリ・`profile.md`・`notes/` に認証情報を書かないでください。
- ファイル権限（`chmod 0600`）は Windows では効きません。トークンの機密性は**権限ではなく** OS キーストア／claude.ai 保管庫で守られます。

## うまくいかないときは

| 症状 | 対処 |
| --- | --- |
| `/mcp` にサービスが出ない | claude.ai → Settings → Connectors で「接続済み」か確認 → Claude Code を再起動 |
| 認可後もツールが呼べない | プランが Max / Team / Enterprise か確認 |
| `gh auth login` でブラウザが開かない | 表示 URL を手動でブラウザに貼り、ワンタイムコードを入力 |
| `gh auth status` が `Logged in` にならない | `gh auth logout` 後に `gh auth login --web` をやり直す |
| 会社プロキシ下で認可が失敗 | claude.ai・github.com への到達性を情シスに確認 |

さらに詳しくは **[トラブルシューティング / FAQ](/guide/faq)** を参照してください。
