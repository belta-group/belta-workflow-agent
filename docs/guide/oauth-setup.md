# 4 ツール OAuth 接続

このページを読むと、Belta ワークフローエージェントに **Notion / Slack / Google Drive / GitHub** の 4 つのアプリをつなぐ作業が、自分の手で最後まで完了できます。やることは基本「アプリの『許可』ボタンを押すだけ」。長いパスワードのコピペは要りません。

このエージェントは、いわば **4 つのアプリを使い分ける優秀な秘書**です。秘書に仕事を任せるには、まず「このアプリを見てもいいですよ」とあなたが許可してあげる必要があります。その許可作業がこのページのゴールです。

::: info はじめる前に必要なもの
claude.ai の **Max / Team / Enterprise** プラン（有料プラン）の契約。claude.ai の接続設定（Connectors）を使うために必要です。
:::

つなぎ方には「**安全につなぐ方式（OAuth）**」を使います。これは、秘書に家の合鍵を丸ごと渡してしまうのではなく、**訪問のたびにインターホンで「どうぞ」と許可する**イメージです。あなたは画面に出る「許可」ボタンを押すだけ。パスワードそのものを秘書に教えたり、パソコンの中に保存したりはしません。

## 一覧

結論から言うと、**Notion・Slack・Google Drive の 3 つは claude.ai の画面でボタンを押すだけ**、**GitHub だけターミナル（黒い画面）で 1 回コマンドを打つ**作業になります。下の表はその早見表です。いま全部わからなくても、後のセクションで 1 つずつ手順を追うので大丈夫です。

| ツール | つなぎ方 | あなたがやること | 鍵の保管場所 | つながったか確認する方法 |
| --- | --- | --- | --- | --- |
| **Notion** | claude.ai の接続設定（Connectors） | claude.ai → Settings → Connectors → Notion で「許可」 | claude.ai 側の保管庫 | `/mcp` で一覧に出るか確認 |
| **Slack** | claude.ai の接続設定（Connectors） | claude.ai → Settings → Connectors → Slack で「許可」 | claude.ai 側の保管庫 | `/mcp` で一覧に出るか確認 |
| **Google Drive** | claude.ai の接続設定（Connectors） | claude.ai → Settings → Connectors → Google Drive で「許可」 | claude.ai 側の保管庫 | `/mcp` で一覧に出るか確認 |
| **GitHub** | GitHub 用の小さな道具（gh）で「許可」 | ターミナルで `gh auth login --web` を 1 回実行 | OS が暗号化して鍵を保管する金庫（OS 標準資格情報ストア） | `gh auth status` で確認 |

::: tip 用語のミニ解説
- **接続設定（Connectors）** … claude.ai 側にある「どのアプリとつなぐか」の設定画面のこと。
- **`/mcp`** … Claude Code に「いま使えるアプリ連携機能（MCP）の一覧を見せて」と頼むコマンド。秘書が「今日はこのアプリを操作できます」と手元のリストを見せてくれるイメージです。
:::

## なぜ認証が 2 系統に分かれるのか

結論として、**つなぐ相手によって入口が 2 種類**あります。Notion・Slack・Google Drive は claude.ai の画面から、GitHub だけはあなたのパソコン側の道具から許可します。理由は、GitHub だけ仕組みをあえて軽くしているためです。

| 系統 | 対象 | 仕組み（やさしい説明） |
| --- | --- | --- |
| **claude.ai の画面で許可する系統** | Notion / Slack / Google Drive | claude.ai が裏側でアプリ連携機能（MCP）を肩代わりして動かします。あなたが「許可」すると、鍵は claude.ai 側に預けられ、秘書が仕事をするたびに claude.ai の中だけで使われます。 |
| **パソコンの道具で許可する系統** | GitHub | アプリ連携機能（MCP）を介さず、あなたのパソコンにある GitHub 用の小さな道具（gh）が、鍵を OS の金庫に直接しまいます。操作はターミナルから `gh` という道具を直接呼びます。 |

**GitHub だけ仕組みを変えている理由**：常に動かしておく連携機能（MCP）を 1 つ減らしてパソコンを軽くするため、操作の記録（監査ログ）を 1 か所にまとめるため、そして非エンジニアでも `gh auth login --web` という 1 行だけで済ませられるようにするためです。

---

## Notion（claude.ai Connector OAuth）

claude.ai の画面で「許可」ボタンを押すだけで完了します。

1. ブラウザで claude.ai を開く。
2. **Settings → Connectors**（設定 → 接続設定）を開く。
3. **Notion** を選び **Connect / 認可**（接続 / 許可）をクリック。
4. Notion 側の確認画面で、つなぎたいワークスペースを選んで **許可** する。
5. claude.ai に戻り、Notion が「接続済み」と表示されていれば成功。

**つながったか確認**: Claude Code で `/mcp` を実行し、Notion のツール（`notion-search` / `notion-fetch` / `notion-create-*` など）が一覧に出ていれば OK です。

## Slack（claude.ai Connector OAuth）

Notion と同じく、claude.ai の画面で「許可」するだけです。

1. claude.ai → **Settings → Connectors**。
2. **Slack** を **Connect / 認可**（接続 / 許可）。
3. Slack の許可画面で、つなぎたいワークスペースを選んで **許可**。
4. claude.ai で「接続済み」を確認。

**つながったか確認**: `/mcp` で Slack のツール（`slack_read_*` / `slack_search_*` / `slack_send_message` など）が一覧に出ていれば OK です。

## Google Drive（claude.ai Connector OAuth）

こちらも claude.ai の画面で「許可」するだけです。

1. claude.ai → **Settings → Connectors**。
2. **Google Drive** を **Connect / 認可**（接続 / 許可）。
3. Google アカウントを選び、表示される「何を見せてよいか（要求スコープ）」を確認して **許可**。
4. claude.ai で「接続済み」を確認。

**つながったか確認**: `/mcp` で Google Drive のツール（`search_files` / `read_file_content` / `list_recent_files` など）が一覧に出ていれば OK です。

## GitHub（`gh` CLI device flow OAuth）

GitHub だけは、claude.ai の画面ではなく、あなたのパソコンにある **GitHub 用の小さな道具（gh）** を使います。この道具がまだ入っていないと先に進めないので、**最初に自動セットアップを試す**のがおすすめです。

### ステップ 1: 道具（gh）を用意する

まずは自動セットアップを実行してください。次のコマンドを Claude Code に実行してもらうと、お使いの OS の入手手段（macOS なら Homebrew、Windows なら winget）を使って `gh` を自動で入れてくれます。すでに入っている場合は何もせず終わります。

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-gh.js"
```

::: tip 自動で入らなかったときは
自動セットアップが使えない環境では、コマンドの出力（JSON 形式の案内）に従って、公式サイト <https://cli.github.com> から手動で入れてください。

手動で入れる場合のコマンドは次のとおりです（上の自動セットアップが使えないときの予備手段です）。

- macOS: `brew install gh`
- Windows: `winget install GitHub.cli`（または公式インストーラ）
:::

### ステップ 2: 「許可」する

道具が用意できたら、ターミナルで「許可」の手続きをします。これは **画面に出るコードを入力して許可する方式**です。

1. ターミナルで次を実行：

   ```
   gh auth login --web
   ```

2. 質問に答えて `GitHub.com` → プロトコル `HTTPS` を選ぶ。
3. 表示された **その場限りのコード（ワンタイムコード）** をメモし、`Enter` でブラウザを開く。
4. ブラウザでそのコードを入力し **Authorize**（許可）する。
5. ターミナルに `Logged in as <ユーザー名>` と出れば完了。

**つながったか確認**: `gh auth status` を実行し、`Logged in to github.com` と表示されれば OK です。

---

## 接続検証（まとめ）

最後に、4 つすべてがちゃんとつながったかを確認しましょう。覚えることは 2 つだけです。**claude.ai 系の 3 つは `/mcp`、GitHub は `gh auth status`** で確認します。

| 対象 | コマンド | これが出れば成功 |
| --- | --- | --- |
| Notion / Slack / Google Drive | `/mcp` | 許可した各サービスのツール群が一覧に出る |
| GitHub | `gh auth status` | `Logged in to github.com as <user>` |

::: tip ツール名の頭の文字が違っても気にしないでください
`/mcp` に出るツール名の頭（`mcp__claude_ai_Notion__*` など）は、接続設定（Connectors）の構成によって変わることがあります。**サービス名で目的のツールが見えていれば接続は成功**です。不安なときは `/mcp` で実際の一覧を見て確認してください。
:::

## 認証情報の保管（セキュリティ）

結論として、**あなたの鍵がパソコンの中に「そのまま読める形」で置かれることはありません**。Notion・Slack・Google Drive の鍵は claude.ai の保管庫に、GitHub の鍵は OS が暗号化して鍵を保管する金庫（OS 標準資格情報ストア）に、それぞれ安全にしまわれます。

| 系統 | 保管場所 | パソコン内に「そのまま読める鍵」 |
| --- | --- | --- |
| Notion / Slack / Google Drive | claude.ai 側の保管庫 | 無し |
| GitHub | OS が暗号化して鍵を保管する金庫（OS 標準資格情報ストア。macOS: keychain、Windows: 資格情報マネージャー など） | 無し（金庫が暗号化して保管） |

::: warning やってはいけないこと
- リポジトリ・`profile.md`・`notes/` などのファイルに、鍵やパスワードを直接書かないでください。
- ファイルの読み取り制限（`chmod 0600`）は Windows では効きません。鍵の安全は、**ファイルの権限ではなく** OS の金庫や claude.ai の保管庫で守られています。
:::

## うまくいかないときは

困ったときは、まず下の早見表で症状を探してください。多くは「接続済みになっているか確認」か「Claude Code を再起動」で直ります。

| 症状 | 対処 |
| --- | --- |
| `/mcp` にサービスが出ない | claude.ai → Settings → Connectors で「接続済み」になっているか確認し、Claude Code を再起動する |
| 許可したのにツールが使えない | プランが Max / Team / Enterprise になっているか確認する |
| `gh` が見つからない・入っていない | `node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-gh.js"` を実行して自動セットアップする（入らなければ出力の案内に従う） |
| `gh auth login` でブラウザが開かない | 表示された URL を手動でブラウザに貼り付け、その場限りのコードを入力する |
| `gh auth status` が `Logged in` にならない | `gh auth logout` してから `gh auth login --web` をやり直す |
| 会社のネットワーク（プロキシ）下で許可が失敗する | claude.ai と github.com につながるか、情シスに確認してもらう |

さらに詳しくは **[トラブルシューティング / FAQ](/guide/faq)** を参照してください。
