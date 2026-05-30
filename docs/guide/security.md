# セキュリティと権限

このエージェントは開発ツールではなく **業務窓口**（Notion / Slack / Google Drive / GitHub）です。したがって脅威の中心は、**機密情報の外部送信・リポジトリ流出**です。これを 3 つの独立した層で守ります。1 層が抜けても次が止めます。

| 層 | 実装 | 守る境界 | タイミング |
| --- | --- | --- | --- |
| **L1: PII 検知フック** | `hooks/pre-tool-use.js` | 外部送信・書き込みツールの呼び出し | 実行**直前**にブロック |
| **L2: permission allowlist** | `.claude/settings.json`（allow / ask / deny） | ツール実行可否そのもの | 呼び出し判定時 |
| **L3: Git 漏洩防止** | `.gitleaks.toml` + GitHub Actions | リポジトリへの commit / push | コミット・CI 時 |

加えて **L0: エージェント運用ルール**（書き込み前に内容を確認、機密度を尊重）が手前で働きます。

## 機密度 3 段階

オンボーディングで選んだ機密度（`~/.belta/profile.md` の `confidentiality`）が、すべての判断の基準になります。

| 機密度 | 意味 | 外部送信前の扱い |
| --- | --- | --- |
| **公開** | 社外公開してよい情報が中心 | 通常の確認 |
| **社外秘** | 社内限定。社外流出禁止 | 書き込み・送信前に内容を要約して確認 |
| **極秘** | 個人情報・経営情報など最高機密 | 外部送信は原則回避。必要時は厳格に確認、PII 検知を強めに解釈 |

## L1: PII 検知フック

書き込み・外部送信の**直前**に、内容へ機密情報が含まれていないかを自動チェックします。検知すると、その操作を**ブロック**し、除去・マスキングや外部送信不要な手段への切り替えを促します。

### 検知対象

| 種別 | 検知ロジック | 誤検知抑制 |
| --- | --- | --- |
| クレジットカード番号 | 16 桁（4 桁 ×4、区切り任意） | **Luhn 検証**に通った候補のみ |
| マイナンバー | 12 桁（4-4-4） | 続く 16 桁（CC）は境界で除外 |
| メールアドレス一括 | `@` を含むアドレス | **ユニーク 5 件以上**で発火（個別 1 件は通す） |
| 機密ラベル | `マル秘` / `㊙` / `社外秘` / `Confidential`（大小無視） | — |
| パスワードリテラル | `password` の直後に `:` または `=` | — |

### 対象となるツール

**書き込み・外部送信系のみ**が対象です。読み取り系（検索 / 閲覧 / 一覧）は素通しします。

- **Slack**: `slack_send_message` / `slack_send_message_draft` / `slack_create_canvas` / `slack_schedule_message` / `slack_update_canvas`
- **Notion**: `notion-create-*` / `notion-update-*` / `notion-create-comment` / `notion-duplicate-page` / `notion-move-pages`
- **Google Drive**: `create_file` / `copy_file`
- **GitHub（Bash）**: `gh issue/pr create|comment|edit` / `gh release|gist create` / `gh api --method POST|PATCH|PUT`
- **HTTP クライアント（Bash）**: `curl` / `wget` / `http`

::: tip 利用者から見た挙動
普段の読み取りや、機密を含まない書き込みは妨げられません。**マイナンバーやカード番号、「社外秘」ラベルなどを含んだまま外部送信しようとしたときだけ**ブロックされます。その場合は、該当箇所を除いて送り直してください。
:::

## L2: permission allowlist

ツールの実行可否を 3 分類で制御します。判定の優先順位は **deny > ask > allow** で、どのルールにも合致しない操作は既定で **ask**（確認）になります。

| 分類 | 基準 | 利用者から見た挙動 | 例 |
| --- | --- | --- | --- |
| **allow** | 読み取り・安全な操作 | 確認なしで実行 | `Read`、`gh pr list`、Notion/Slack/Drive の検索・閲覧 |
| **ask** | 書き込み・外部影響あり | **毎回確認が出る** | Slack 送信、Notion/PR 作成、`git push` / `commit`、`curl` / `wget` |
| **deny** | 破壊的・取り返しのつかない操作 | **実行できない** | `rm -rf`、`sudo`、`git push --force`、`gh repo delete`、各種 `*delete*` |

具体例：

- `gh pr list`（読み取り）→ プロンプトなしで通る。
- `slack_send_message`（送信）→ 確認が出る。
- `gh issue create`（作成）→ 確認が出る。
- `rm -rf ...` / `git push --force` → ブロックされる。
- `.env` の中身の読み取り（`Read(.env)` / `cat .env`）→ ブロックされる。

::: info L1 と L2 は独立しています
permission で承認（ask → 許可）しても、内容に PII が含まれていれば L1（PII フック）がブロックします。逆もまた然りで、二重に守られます。
:::

権限ルールは同梱の `.claude/settings.json` で配布されます。環境によって自動マージが効かない場合は、導入手順の **[Step 5](/guide/getting-started#step-5-権限ルールの適用-必要な場合のみ)** で手動適用できます。

## L3: Git 漏洩防止

リポジトリへの commit / push 時に、`.gitleaks.toml` と GitHub Actions（`secret-scan.yml`）が機密情報をスキャンします。マイナンバー / クレジットカード / メールアドレス一括 / パスワードリテラル / 機密ラベル / 社内ドメイン / 標準 API キーパターンを検知し、混入していれば CI が fail します。

## 認証情報の扱い（やってよいこと / いけないこと）

### ❌ やってはいけない

- API キー・トークン・パスワードを `profile.md` / `notes/` / リポジトリに書く。
- 認証情報をスクリプトや設定に直書きする。
- Slack / Notion 等に認証情報を貼り付けて共有する。

### ✅ 守ること

- 認証は OAuth ベース。Notion / Slack / Google Drive は claude.ai 側 OAuth 保管庫、GitHub は OS 標準資格情報ストアにトークンが保管されます（ローカル平文なし）。
- 個人データ（`~/.belta/` 配下）はリポジトリにコミットしない（`.gitignore` で除外済み）。

## 万一、機密情報を出してしまったら

1. **STOP** — 進行中の送信・commit を直ちに止める。
2. **範囲特定** — どの情報が、どのツール／チャンネル／リポジトリに出たかを確認。
3. **除去** — 送信済みなら削除（Slack メッセージ削除 / Notion ページ修正 / commit revert）。Git 履歴に入った秘密は履歴から除去。
4. **ローテーション** — 露出した認証情報は**必ず無効化・再発行**する（削除だけでは不十分）。
5. **横展開確認** — 同種の漏洩が他にないか確認。
6. **記録 + 報告** — 経緯と対処を `~/.belta/notes/` に残し（機密値そのものは書かない）、情シス推進担当へ報告する。
