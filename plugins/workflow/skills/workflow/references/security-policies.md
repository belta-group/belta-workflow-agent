# セキュリティポリシー

BELTA ワークフローエージェントの機密情報・認証情報の取り扱い方針。`everything-claude-code`（`rules/security.md` / `skills/security-review/SKILL.md`）を起点に、**業務自動化エージェント向け（PII / 機密キーワード / 外部送信ガード / OAuth）** に再構成したもの。実装は `hooks/pre-tool-use.js`（PII 検知）・`.claude/settings.json`（permission allowlist, Day 7）・`.gitleaks.toml`（Git 層, Day 10）の 3 つで多層化する。

> このエージェントは開発ツールではなく **業務窓口**（Notion / Slack / Google Drive / GitHub）。脅威の中心は SQL インジェクション等ではなく、**機密情報の外部送信・リポジトリ流出**。本ポリシーはそこに最適化する。

---

## 1. 多層防御モデル

機密情報を「外に出さない」ことを独立した層で守る。1 層が抜けても次が止める。

| 層 | 実装 | 守る境界 | タイミング |
| --- | --- | --- | --- |
| **L1: PII / 機密ファイル検知フック** | `hooks/pre-tool-use.js`（PreToolUse） | 外部送信・書き込み／機密ファイル読取 | 実行**直前**に deny |
| **L1.5: スキル許可ゲート** | `hooks/skill-gate.js`（PreToolUse: Skill）＋ `.claude/skill-policy.json` | 未記録スキルの起動 | 起動**直前**に ask（設定で deny） |
| **L2: permission allowlist** | `.claude/settings.json` の allow / ask / deny | ツール実行可否そのもの | 呼び出し判定時 |
| **L2.5: サンドボックス実行** | `.claude/settings.json` の `sandbox`（OS レベル） | Bash とその子プロセスのファイル・ネットワーク | プロセス実行**中**ずっと |
| **L2.6: MCP 許可リスト** | `.claude/settings.json` の `allowedMcpServers` | 使用できる MCP サーバそのもの | 接続時 |
| **L3: Git 漏洩防止** | `.gitleaks.toml` + GitHub Actions | リポジトリへの commit / push | コミット・CI 時 |

加えて **L0: エージェント運用ルール**（SKILL.md 運営モード）が「機密度を尊重し書き込み前に確認」を行う。フックは最後の砦であり、運用での配慮を前提に設計する。

**層の役割の違いを混同しないこと**: L1/L2 は「Claude Code が呼ぶツール」を判定する層で、Node や Python のスクリプトがファイルを自分で開くところまでは追えない。L2.5（サンドボックス）は OS がプロセスに境界を課すので、**モデルが何を実行しようとしたかに関係なく**効く。逆にサンドボックスは Bash 専用で、Read / Edit / MCP には及ばない。両方が必要。

**適用経路**: L2 は `scripts/apply-permissions.js`、L2.5 / L2.6 と `model` / `cleanupPeriodDays` / `permissions.disableBypassPermissionsMode` は `scripts/apply-governance.js` が、専用フォルダの `.claude/settings.local.json` へ届ける（プラグイン同梱 settings が自動マージされない環境向けのフォールバック）。届いていなければ `hooks/session-start.js` の (G) が起動時に警告する。

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

### 3-2. 機密ファイル読取ガード（L1 役割 3）

`.env` / SSH 秘密鍵 / `*.pem` / クラウド認証情報を**読み出そうとする操作**をブロックする。判定は `hooks/secret-file-util.js`。

| 検知対象 | 例 |
| --- | --- |
| 環境変数ファイル | `.env` / `.env.local` / `.env.*` / `secrets.env` / `*.env` |
| SSH 鍵 | `~/.ssh/` 配下 / `id_rsa` / `id_ed25519` |
| 証明書・秘密鍵 | `*.pem` / `*.p12` / `*.pfx` / `*.key` |
| クラウド認証情報 | `~/.aws/` / `~/.config/gcloud/` / `~/.config/gh/` |

- **対象ツール**: `Bash`（コマンド文字列全体）/ `Grep`（`path` / `glob`）/ `Glob`（`pattern` / `path`）。`Read` / `Edit` は L2 の deny ルール（`Read(//**/.env)` 等）が担当する。
- **なぜコマンド列挙に頼らないか**: `Read(...)` deny は Claude Code が認識するファイルコマンド（`cat` / `head` / `tail` / `sed`）までしか届かず、`awk` / `xxd` / `source` / リダイレクト / 自作スクリプト経由には効かない。「読める道具」を列挙し続ける戦いは必ず負けるので、**コマンドではなく参照されているファイル**を見る。
- **誤遮断の回避**: `.env.example` / `.env.sample` / `.env.template` / `.env.dist` は素通し。正規表現リテラル（`grep -rn "\.env" docs/` のようにエスケープや文字クラスを含むトークン）は「検索パターン」と見なして素通し。追加の例外は `~/.belta/config.yaml` の `env_guard_exceptions`（カンマ区切り）で足せる。
- **監査**: deny した事実は `~/.belta/audit/security/<YYYY-MM-DD>.jsonl` に 1 行残る（**判定メタのみ。ペイロード原文＝機密は書かない**。保持 90 日）。

---

## 3-3. スキル許可ゲート（L1.5）

「許可されたスキルしか使えない」を `hooks/skill-gate.js` が担保する。静的な allow 列挙では自作・導入スキルを壊すため、allowset を起動時に決定的に組み立てる。

| allowset の出どころ | 内容 |
| --- | --- |
| 同梱スキル | `<plugin>/skills/*/SKILL.md` の `name` |
| 自作スキル | `~/.belta/skills/AUTHORED.md`（`deleted_at` 付きは除外） |
| 導入済みスキル | `~/.belta/skills/SKILLS.md` の `installed:` 行（`uninstalled:` 付きは除外） |
| 静的許可 | `.claude/skill-policy.json` の `allowedSkills` / `allowedPrefixes`（Anthropic 公式等） |

- allowset 外は既定 **ask**。`~/.belta/config.yaml` の `skill_gate_mode` で `ask` / `deny` / `off` に切替。
- スキル名が取れない（フィールド名の変更等）ときは**素通し**する。判定不能をブロックすると全スキルが止まるため。
- 確認ダイアログには `scripts/skill-audit.js` の結果（未監査 / high 件数）を添える。
- 特定スキルを恒久的に禁止したい場合は、permissions の deny に入力パラメータ照合ルール `Skill(skill:<name>)` を書ける（ゲートとは別レイヤー）。

## 3-4. スキル安全性チェック（`scripts/skill-audit.js`）

導入前・生成直後にスキルフォルダを静的走査し、目視すべき点を機械的に洗い出す。**検出までで採否は判定しない**（判断は人と LLM）。

| 観点 | severity |
| --- | --- |
| 破壊操作（`rm -rf` / `sudo` / `git push --force` / `reset --hard`） | high |
| 認証情報の外部送信（同一ファイル内に「認証情報の参照」と「外部送信」の両方） | high |
| 難読化実行（base64 → `sh`/`node` / `eval` / `new Function`） | high |
| エージェント自身の設定・フックの書き換え | high |
| frontmatter 欠落（`name` / `description`） | high |
| 外部への POST / OS 依存コマンド / シェルスクリプト同梱 / description が短い | medium |
| 外部ネットワークへのアクセス | info |

- Markdown では**フェンス付きコードブロックの中だけ**を実行されうる領域として扱う（散文で `rm -rf` に言及しているだけの説明文を誤検知しない）。同梱 14 スキルは検出 0 件がベースライン。
- 結果は `~/.belta/audit/skills/<name>.json` に保存し、スキル許可ゲートが参照する。
- **通ったことは安全の保証ではない**（動的にコードを取得する等は原理的に検出できない）。目視チェックリスト（[skill-allowlist.md](../../skill-suggestion/references/skill-allowlist.md)）と併用する。

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

### 6-2. ガバナンスキー（permissions 以外）

権威ソースは同じ `.claude/settings.json`。適用は `scripts/apply-governance.js`。

| キー | 値 | 意図 |
| --- | --- | --- |
| `sandbox.enabled` | `true` | Bash を OS レベルの境界内で実行する |
| `sandbox.failIfUnavailable` | `false` | **Windows ネイティブは sandbox 非対応**なので、非対応環境では従来どおり動かす（セッションを壊さない） |
| `sandbox.allowUnsandboxedCommands` | `true` | ソフト運用。sandbox 内で動かないコマンドは確認を経て外で実行できる（業務を止めない） |
| `sandbox.excludedCommands` | `gh` / `docker` / `open` / `osascript` | Seatbelt 下で TLS 検証が落ちる Go 製 CLI と、ブラウザ認証フロー（Apple Events）を除外 |
| `sandbox.network.allowedDomains` | GitHub / npm レジストリのみ | 事前許可ドメインを最小に保つ。**広いドメイン許可は流出経路になる**（プロキシは TLS を検査しない） |
| `sandbox.credentials.files` | `~/.ssh` / `~/.aws/credentials` / `~/.config/gh` | サンドボックスの既定読取ポリシーは「認証情報も読める」なので明示的に塞ぐ |
| `allowedMcpServers` | Notion / Slack / Google Drive / scheduled-tasks | **ホワイトリスト**。名前は環境依存（UUID になることがある）ので `/mcp` の実名に合わせる |
| `permissions.disableBypassPermissionsMode` | `"disable"` | `--dangerously-skip-permissions` で全ゲートを無効化する事故を防ぐ |
| `cleanupPeriodDays` | `30` | 会話ログを無期限に滞留させない |
| `model` | apex のエイリアス | 既定モデル（[model-tiers.md](model-tiers.md)）。弱いマージで、利用者が変えたら尊重する |

- **設定ファイル自体の書き換えは deny ではなく ask**（業務上必要な場面があるため塞ぎきらない）。`Edit` / `Write` で settings や hooks を触ると、`hooks/explain-util.js` のやさしい説明つきで確認ダイアログが出る。なおサンドボックスは Bash からの settings 書き込みを OS レベルで拒否する（自分のポリシーを自分で緩められない）。
- **`allowedMcpServers` は空配列を書かない**（全 MCP が使えなくなるため、`apply-governance.js` が空ならスキップする）。

---

## 7. インシデント対応プロトコル

機密情報の流出・漏洩（の疑い）を検知したら：

1. **STOP** — 進行中の送信・commit を直ちに止める。
2. **範囲特定** — どの情報が、どのツール／チャンネル／リポジトリに出たかを確認。
3. **除去** — 送信済みなら削除（Slack メッセージ削除 / Notion ページ修正 / commit revert）。Git 履歴に入った秘密は履歴から除去（filter-repo 等）し、push 済みなら即対応。
4. **ローテーション** — 露出した認証情報（トークン・キー）は**必ず無効化・再発行**する。削除だけでは不十分。
5. **横展開確認** — 同種の漏洩が他にないかコードベース・履歴を確認。
6. **記録** — 経緯と対処を `~/.belta/notes/` に残す（機密値そのものは書かない）。

### 一次資料: セキュリティ監査ログ

「いつ・どのツールで・何が理由で止まったか」は `~/.belta/audit/security/<YYYY-MM-DD>.jsonl` に残る（保持 90 日）。調査はここから始める。

```
node -e "const fs=require('fs'),os=require('os'),p=require('path');const d=p.join(os.homedir(),'.belta','audit','security');for(const f of fs.readdirSync(d).sort())console.log(fs.readFileSync(p.join(d,f),'utf8'))"
```

記録されるのは **判定メタだけ**（`decision` / `hook` / `tool` / `rule` / 検出種別ラベル / `session`）。機密を止めるための記録が機密の複製になってはいけないので、**ペイロード原文は書かない**。記録対象は「実際にブロックした deny」と「スキル許可ゲートの ask / deny」に限る（毎回の書き込み確認は記録しない。ノイズで調査価値を薄めないため）。

---

## 8. セキュリティ検証ハーネス

ポリシーが効いていることを定期確認する（`docs/tasks.md` Day 6 / Day 11-12 と対応）。

| 検証 | 手順 | 期待 |
| --- | --- | --- |
| PII 遮断 | マイナンバー / CC / 機密ラベル等のサンプルを Slack・Notion 書き込みに投入（各 3 件） | 全件 deny |
| 誤検知率 | 通常テキスト 20 件で書き込み試行 | 誤遮断 1 件以下 |
| 機密ファイル遮断 | `head .env` / `grep KEY .env.local` / `cat secrets.env` / `cat ~/.ssh/id_rsa` を Bash・Grep・Glob で投入 | 全件 deny |
| 機密ファイル誤検知 | `cat .env.example` / `grep -rn "\.env" docs/` / 無関係コマンド 20 件 | 全件素通し |
| スキル許可ゲート | 同梱・導入済み・許可リスト掲載スキル → 素通し。未記録スキル → ask（`deny` モードなら deny） | 分類どおり |
| スキル安全性 | 同梱 14 スキル全走査（誤検知ベースライン）＋悪性フィクスチャ（破壊操作 / 流出 / 難読化 / frontmatter 欠落 / 設定改変） | 同梱は 0 件、悪性は該当ルールが high |
| permission | `rm -rf /tmp/test` が deny、`slack_send_message` が ask、`gh pr list` が allow | 分類どおり |
| sandbox | 許可外ドメインへの `curl` が遮断される／`gh api /user` は通る（excludedCommands）／`/sandbox` で Mode・Config が見える | 境界どおり |
| ガバナンス適用 | 一時 HOME で `apply-governance.js` を新規・既存・再実行（冪等）・`--dry-run`・利用者独自キー保持・キー削除伝播 | 差分どおり／独自キーは無傷 |
| ドリフト検知 | 未適用の専用フォルダで SessionStart | (G) 警告が注入される（適用後は出ない） |
| Git 層 | 意図的に PII を commit | gitleaks Action が 100% ブロック |

> 検証用サンプル PII は**実在しないダミー値**を使い、テキストもリポジトリに残さない。フックの検証は擬似ペイロードを stdin に渡して行う（例: `echo '{"tool_name":"Bash","tool_input":{"command":"head .env"}}' | node hooks/pre-tool-use.js`）。一時 HOME（`HOME=<tmpdir>`）で走らせ、実際の `~/.belta/` を汚さないこと。

---

## 関連ファイル

- PII / 機密ファイル検知フック: `hooks/pre-tool-use.js`（判定エンジン: `hooks/secret-file-util.js`）
- スキル許可ゲート: `hooks/skill-gate.js` ＋ `plugins/workflow/.claude/skill-policy.json`
- スキル安全性チェック: `scripts/skill-audit.js`
- セキュリティ監査ログ: `hooks/audit-log.js`（`~/.belta/audit/security/`）
- ガバナンス権威ソース（permissions / sandbox / allowedMcpServers / model）: `plugins/workflow/.claude/settings.json`
- ガバナンス適用: `scripts/apply-permissions.js`（permissions）/ `scripts/apply-governance.js`（それ以外）
- ガバナンス未適用の検知: `hooks/session-start.js` の (G)
- Git 漏洩防止: `.gitleaks.toml` + `.github/workflows/secret-scan.yml`（Day 10）
- 認証情報の保管: [mcp-setup.md](mcp-setup.md)
- 運営モードの確認フロー: [SKILL.md](../SKILL.md)
