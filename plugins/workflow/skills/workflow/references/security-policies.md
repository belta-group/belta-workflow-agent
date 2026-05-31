# セキュリティポリシー

Belta ワークフローエージェントの機密情報・認証情報の取り扱い方針。`everything-claude-code`（`rules/security.md` / `skills/security-review/SKILL.md`）を起点に、**業務自動化エージェント向け（PII / 機密キーワード / 外部送信ガード / OAuth）** に再構成したもの。実装は `hooks/pre-tool-use.js`（PII 検知）・`.claude/settings.json`（permission allowlist, Day 7）・`.gitleaks.toml`（Git 層, Day 10）の 3 つで多層化する。

> このエージェントは開発ツールではなく **業務窓口**（Notion / Slack / Google Drive / GitHub）。脅威の中心は SQL インジェクション等ではなく、**機密情報の外部送信・リポジトリ流出**。本ポリシーはそこに最適化する。

---

## 1. 多層防御モデル

機密情報を「外に出さない」ことを 3 つの独立した層で守る。1 層が抜けても次が止める。

| 層 | 実装 | 守る境界 | タイミング |
| --- | --- | --- | --- |
| **L1: PII 検知フック** | `hooks/pre-tool-use.js`（PreToolUse） | 外部送信・書き込みツール呼び出し | 実行**直前**に deny |
| **L2: permission allowlist** | `.claude/settings.json` の allow / ask / deny | ツール実行可否そのもの | 呼び出し判定時 |
| **L3: Git 漏洩防止** | `.gitleaks.toml` + GitHub Actions | リポジトリへの commit / push | コミット・CI 時 |

加えて **L0: エージェント運用ルール**（SKILL.md 運営モード）が「機密度を尊重し書き込み前に確認」を行う。フックは最後の砦であり、運用での配慮を前提に設計する。

---

## 2. 機密度 3 段階（profile.md 連携）

オンボーディングで収集した機密度（`~/.belta/profile.md` の `confidentiality`）を全判断の基準にする。

| 機密度 | 意味 | 外部送信前の扱い |
| --- | --- | --- |
| **公開** | 社外公開してよい情報が中心 | 通常の確認 |
| **社外秘** | 社内限定。社外流出禁止 | 書き込み・送信前に内容要約して確認 |
| **極秘** | 個人情報・経営情報など最高機密 | 外部送信は原則回避。必要時は厳格に確認、PII 検知を強めに解釈 |

- 運営モードでは**必ず最初に `profile.md` を読み込み**、機密度を文脈に入れる。
- 社外秘・極秘の内容を Slack 公開チャンネルや外部に送る前は必ず確認を取る。

---

## 3. PII / 機密情報の検知（L1 フック仕様）

`hooks/pre-tool-use.js` が検知する対象。**この表は実装と一致させること**（変更時は両方を更新）。

| 種別 | 検知ロジック | 誤検知抑制 |
| --- | --- | --- |
| **クレジットカード番号** | 16 桁（4 桁 ×4、区切り任意） | **Luhn 検証**に通った候補のみ |
| **マイナンバー** | 12 桁（4-4-4） | 前後にもう 1 グループが続く 16 桁（CC）は**境界で除外** |
| **メールアドレス一括** | `@` を含むアドレス | **ユニーク 5 件以上**で発火（個別 1 件は通す） |
| **機密ラベル** | `マル秘` / `㊙` / `社外秘` / `Confidential`（大小無視） | — |
| **パスワードリテラル** | `password` の直後に `:` または `=` | — |

検知時はその操作を **deny**（ブロック）し、検出種別と「除去・マスキング、または外部送信不要な手段への切替」を促すメッセージを返す。

### 検知対象となるツール（外部送信・書き込み系のみ）

読み取り系（`*search*` / `*read*` / `*get*` / `*list*` / `gh` 読み取り）は対象外で素通しする。書き込み系のみを対象にする：

- **Slack**: `slack_send_message` / `slack_send_message_draft` / `slack_create_canvas` / `slack_schedule_message` / `slack_update_canvas`
- **Notion**: `notion-create-*` / `notion-update-*` / `notion-create-comment` / `notion-duplicate-page` / `notion-move-pages`
- **Google Drive**: `create_file` / `copy_file`
- **GitHub（Bash）**: `gh issue/pr create|comment|edit` / `gh release|gist create` / `gh api --method POST|PATCH|PUT`
- **HTTP クライアント（Bash）**: `curl` / `wget` / `http`

> MCP ツール名はサーバ接頭辞付き（`mcp__<id>__slack_send_message` 等）のため、フックは**サフィックス一致**で判定する。接頭辞は Connector 構成で変わるため固定値に依存しない。

---

## 4. 外部送信ガードの原則（L0 運用）

L1 フックの手前で、エージェント自身が守るべき運用原則。

- **書き込み系（送信・作成・更新・PR 作成等）は実行前に内容を要約して確認する。** 読み取り系は確認不要。
- **機密度を必ず尊重する。** 社外秘・極秘を外部に出す前は確認必須。
- **送信先を意識する。** Slack なら公開／非公開チャンネル、Notion なら共有範囲、Drive なら共有設定を確認する。
- **複数ツールにまたがる依頼**は 1 つずつ実行し、各ステップで送信内容を提示する。
- 機密情報が不要なら**そもそも載せない**（最小化原則）。要約・マスキングで足りるなら原文を送らない。

---

## 5. 認証情報・シークレット管理

Phase -1 は**全 OAuth 化**しており、平文 API キーをローカルに保管しない（[mcp-setup.md](mcp-setup.md) §認証情報の保管）。

### ❌ やってはいけない

- API キー・トークン・パスワードを `profile.md` / `notes/` / `inbox/` / リポジトリに書く。
- 認証情報をハードコードする（スクリプト・設定に直書き）。
- Slack / Notion 等に認証情報を貼り付けて共有する。

### ✅ 守ること

- **Notion / Slack / Google Drive**: claude.ai 側 OAuth 保管庫（ローカル平文なし）。
- **GitHub**: OS 標準資格情報ストア（`gh` CLI 標準。macOS keychain / Windows 資格情報マネージャー等）。
- `.gitignore` の `secrets.env` / `*-credentials.json` / `oauth-token.*` は将来の追加 OAuth 方式への保険として残置（Phase -1 では生成しない）。
- `~/.belta/` 配下（個人データ）はリポジトリに commit しない。

> **ファイル権限に依存しない**: `chmod 0600` は Windows では効かない。トークンの機密性は権限ではなく OS キーストア／claude.ai 保管庫で守る（クロスプラットフォーム規約）。

---

## 6. permission allowlist の原則（L2、Day 7 で実装）

`.claude/settings.json` の `permissions` で 3 分類する。設計原則のみここに記す（具体エントリは Day 7）。

| 分類 | 基準 | 例 |
| --- | --- | --- |
| **allow** | 読み取り・安全な操作（外部影響なし） | Read、`.belta/**` Write、`gh` 読み取り、Notion/Slack/Drive の `search`/`read`/`get`/`list` |
| **ask** | 書き込み・外部影響あり（毎回確認） | Slack/Notion/Drive 書き込み、`gh` 書き込み、`git push`/`commit`、`curl`/`wget` |
| **deny** | 破壊的・取り返しのつかない操作 | `rm -rf`、`sudo`、`git push --force`、`gh repo delete`、各種 `*delete*` |

- **最小権限**: 必要なものだけ allow。判断に迷うものは ask に倒す。
- L1（PII フック）と L2（permission）は独立。ask で承認されても、PII を含めば L1 が deny する。

---

## 7. インシデント対応プロトコル

機密情報の流出・漏洩（の疑い）を検知したら：

1. **STOP** — 進行中の送信・commit を直ちに止める。
2. **範囲特定** — どの情報が、どのツール／チャンネル／リポジトリに出たかを確認。
3. **除去** — 送信済みなら削除（Slack メッセージ削除 / Notion ページ修正 / commit revert）。Git 履歴に入った秘密は履歴から除去（filter-repo 等）し、push 済みなら即対応。
4. **ローテーション** — 露出した認証情報（トークン・キー）は**必ず無効化・再発行**する。削除だけでは不十分。
5. **横展開確認** — 同種の漏洩が他にないかコードベース・履歴を確認。
6. **記録** — 経緯と対処を `~/.belta/notes/` に残す（機密値そのものは書かない）。

---

## 8. セキュリティ検証ハーネス

ポリシーが効いていることを定期確認する（`docs/tasks.md` Day 6 / Day 11-12 と対応）。

| 検証 | 手順 | 期待 |
| --- | --- | --- |
| PII 遮断 | マイナンバー / CC / 機密ラベル等のサンプルを Slack・Notion 書き込みに投入（各 3 件） | 全件 deny |
| 誤検知率 | 通常テキスト 20 件で書き込み試行 | 誤遮断 1 件以下 |
| permission | `rm -rf /tmp/test` が deny、`slack_send_message` が ask、`gh pr list` が allow | 分類どおり |
| Git 層 | 意図的に PII を commit | gitleaks Action が 100% ブロック |

> 検証用サンプル PII は**実在しないダミー値**を使い、テキストもリポジトリに残さない。

---

## 関連ファイル

- PII 検知フック実装: `hooks/pre-tool-use.js`
- permission allowlist: `plugins/workflow/.claude/settings.json`（Day 7）
- Git 漏洩防止: `.gitleaks.toml` + `.github/workflows/secret-scan.yml`（Day 10）
- 認証情報の保管: [mcp-setup.md](mcp-setup.md)
- 運営モードの確認フロー: [SKILL.md](../SKILL.md)
