# MCP 4 ツール接続リファレンス

Belta ワークフローエージェントが連携する 4 ツール（Notion / Slack / Google Drive / GitHub）の接続方法・認証方式・検証コマンドの参照表。実行手順そのものは [`commands/workflow-setup.md`](../../../commands/workflow-setup.md) に、運用時の発話 → ツール分岐は [`SKILL.md`](../SKILL.md) に記載。本ファイルは「どのツールがどの認証で、どう確認するか」を 1 枚で引けるリファレンス。

> **認証はすべて OAuth ベース。** PAT / API キーの手動コピペは不要。平文の API キーをローカルに保管しない（`~/.belta/secrets.env` は Phase -1 では生成しない）。
>
> **前提**: claude.ai の Max / Team / Enterprise プラン契約済み（Connector 利用に必要）。

---

## 一覧表

| ツール | 認証方式 | 利用者の操作 | トークン保管先 | Claude からの呼び出し | 検証 |
| --- | --- | --- | --- | --- | --- |
| **Notion** | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Notion を認可 | claude.ai 側 OAuth 保管庫 | `mcp__claude_ai_Notion__*` | `/mcp` で列挙確認 |
| **Slack** | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Slack を認可 | claude.ai 側 OAuth 保管庫 | `mcp__claude_ai_Slack__*` | `/mcp` で列挙確認 |
| **Google Drive** | claude.ai Connector OAuth | claude.ai → Settings → Connectors → Google Drive を認可 | claude.ai 側 OAuth 保管庫 | `mcp__claude_ai_Google_Drive__*` | `/mcp` で列挙確認 |
| **GitHub** | `gh` CLI device flow OAuth | ターミナルで `gh auth login --web` を 1 回実行 | OS 標準資格情報ストア（`gh` CLI 管理） | `Bash(gh *)` 直接（MCP サーバ無し） | `gh auth status` で `Logged in to github.com` を確認 |

> **MCP ツール名の注意**: 上表の `mcp__claude_ai_Notion__*` 等は想定上の正規名。実際のプレフィックスは Connector の登録構成によって変わる（このセッションのように内部 ID 形式で並ぶこともある）。**確信が持てなければ `/mcp` で実列挙を確認する。**

---

## 認証が 2 系統に分かれる理由

| 系統 | 対象 | 仕組み |
| --- | --- | --- |
| **claude.ai Connector OAuth** | Notion / Slack / Google Drive | claude.ai がホストするリモート MCP サーバー。認可後、トークンは claude.ai 側に保管され、MCP ツール実行時にサーバー内部で使われる |
| **gh CLI device flow OAuth** | GitHub | MCP サーバーを介さず、ローカルの `gh` CLI が OS の資格情報ストアにトークンを保管。操作は Bash 経由の `gh` コマンド直叩き |

**GitHub だけ MCP を置かない理由**（プラン §4）:

- MCP プロセス常駐分のオーバーヘッドを削減。
- 監査が Bash コマンドログ 1 系統で完結（MCP ログと Bash ログに分散しない）。
- 非エンジニアでも `gh auth login --web` 1 コマンドで済み、配布時のオンボーディング負荷が最小。

> OAuth は「認可（トークンを取る／渡す）」、MCP は「実行（ツールを呼ぶ）」。Connector 系は MCP ツール実行の内側で OAuth トークンが使われる。GitHub は OAuth でローカル保管 → `gh` 直叩きで、MCP を介さない。

---

## ツール別 認可手順

オンボーディング（`/workflow-setup` Step 1）で選択したツールのみ案内すればよい。

### Notion（claude.ai Connector OAuth）

1. ブラウザで claude.ai を開く。
2. **Settings → Connectors** を開く。
3. **Notion** を選び **Connect / 認可** をクリック。
4. Notion 側のダイアログで対象ワークスペースを選び **許可** する。
5. claude.ai に戻り、Notion が「接続済み」表示になることを確認。

→ 検証: Claude Code で `/mcp` を実行し、Notion 系ツール（`notion-search` / `notion-fetch` / `notion-create-*` 等）が列挙されること。

### Slack（claude.ai Connector OAuth）

1. claude.ai → **Settings → Connectors**。
2. **Slack** を **Connect / 認可**。
3. Slack の OAuth 画面で対象ワークスペースを選び **許可**。
4. claude.ai で「接続済み」を確認。

→ 検証: `/mcp` で Slack 系ツール（`slack_read_*` / `slack_search_*` / `slack_send_message` 等）が列挙されること。

### Google Drive（claude.ai Connector OAuth）

1. claude.ai → **Settings → Connectors**。
2. **Google Drive** を **Connect / 認可**。
3. Google アカウントを選び、要求スコープを確認して **許可**。
4. claude.ai で「接続済み」を確認。

→ 検証: `/mcp` で Google Drive 系ツール（`search_files` / `read_file_content` / `list_recent_files` 等）が列挙されること。

### GitHub（`gh` CLI device flow OAuth）

MCP ではなくローカル `gh` CLI を使う。`gh` 未導入なら先にインストールする（macOS: `brew install gh` / Windows: `winget install GitHub.cli` または公式インストーラ）。

1. ターミナルで次を実行:

   ```
   gh auth login --web
   ```

2. プロンプトに従い `GitHub.com` → プロトコル `HTTPS` を選択。
3. 表示された **ワンタイムコード**を控え、`Enter` でブラウザを開く。
4. ブラウザでコードを入力し **Authorize** する。
5. ターミナルに `Logged in as <ユーザー名>` が出れば完了。

→ 検証: `gh auth status` を実行し `Logged in to github.com` と表示されること。

---

## 接続検証ステップ（まとめ）

| 対象 | コマンド | 期待結果 |
| --- | --- | --- |
| claude.ai Connector 3 件（Notion / Slack / Google Drive） | `/mcp` | 認可した各サービスのツール群が列挙される |
| GitHub | `gh auth status` | `Logged in to github.com as <user>` |

- Connector 系で列挙されない場合: claude.ai 側で「接続済み」になっているか、Claude Code を再起動して再読み込みしたかを確認。
- `/mcp` のプレフィックスが想定（`mcp__claude_ai_Notion__*` 等）と違っても、サービス名で該当ツールが見えていれば接続成功。実名は SKILL.md の分岐ロジック適用時に `/mcp` 実列挙で都度確認する。

> **完了目標**: 初回オンボーディング全体（プロフィール収集 + 4 ツール接続）を **5 分以内**（4 ツール × 各 1 分目安）。実測は内田氏自身が行う（`docs/tasks.md` Day 5）。

---

## 認証情報の保管（セキュリティ）

| 系統 | 保管先 | ローカル平文 |
| --- | --- | --- |
| Notion / Slack / Google Drive | claude.ai 側 OAuth 保管庫 | 無し |
| GitHub | OS 標準資格情報ストア（`gh` CLI 標準。macOS: keychain、Windows: 資格情報マネージャー 等） | 無し（OS ストアが暗号化保管） |

- リポジトリ・`profile.md`・`notes/` に認証情報を書かない。
- `.gitignore` の `secrets.env` / `*-credentials.json` / `oauth-token.*` は、将来別の OAuth 方式を追加する場合の保険として残置（Phase -1 では生成しない）。
- ファイル権限（`chmod 0600`）は Windows では効かないため、トークンは権限ではなく OS キーストア／claude.ai 保管庫側で守る（多重防御）。

---

## クロスプラットフォーム注意（Mac / Windows）

- `gh` のインストール手段・トークン保管ストアは OS で異なる（上表）。手順文では特定 OS の保管先を断定せず「OS 標準資格情報ストア」と表現する。
- 認可操作はブラウザ（Connector）と `gh auth login --web`（device flow）が中心で、いずれも両 OS で同一手順。
- パス参照（`~/.belta/` 等）はシェルの `~` 展開に頼らず環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。
- 別 PC での導入確認（`/plugin marketplace add` → `/plugin install` → `/workflow-setup`）は、少なくとも 1 台は Windows で実施する（`docs/tasks.md` Day 11-12）。

---

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| `/mcp` にサービスが出ない | claude.ai → Settings → Connectors で「接続済み」か確認 → Claude Code 再起動 |
| Connector 認可後もツールが呼べない | プランが Max / Team / Enterprise か確認（Connector 利用条件） |
| `gh auth login` でブラウザが開かない | 表示 URL を手動でブラウザに貼り、ワンタイムコードを入力 |
| `gh auth status` が `Logged in` にならない | `gh auth logout` 後に `gh auth login --web` をやり直す |
| 会社プロキシ下で認可が失敗 | プロキシ／ファイアウォール設定を情シスに確認（claude.ai・github.com への到達性） |
| ブラウザ操作が必要と言われた | ブラウザ操作スキルは本体非搭載。必要時のみ個別インストール（SKILL.md 参照） |

---

## 関連ファイル

- 実行手順そのもの: [`commands/workflow-setup.md`](../../../commands/workflow-setup.md)
- 運用時の発話 → 4 ツール分岐: [`SKILL.md`](../SKILL.md)
- 書き込み前の PII 検知: `hooks/pre-tool-use.js`
- permission allowlist（allow / ask / deny）: `plugins/workflow/.claude-plugin/plugin.json`（Day 7）
