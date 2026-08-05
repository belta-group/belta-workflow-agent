---
description: BELTA ワークフローエージェントの初回セットアップ（氏名・部署・メール収集 + MCP 4 ツール OAuth 接続）。所要約 5 分。
model: sonnet
---

<!--
model: sonnet — mid ティア。オンボーディングは「5 問収集 + profile.md 生成」が主体の定型
処理のため、セッション既定（apex）より下位に固定する。ただし Step 4（権限スクリプト実行）と
MCP 実名のトラブルシュートで一定の判断が要るため、light ではなく mid を下限とする。
ティア定義は skills/workflow/references/model-tiers.md（モデル名を書く唯一の場所）。
-->


# /workflow-setup — 初回セットアップ

このコマンドは BELTA ワークフローエージェントの **初回オンボーディング**です。インストール後の最初のセッションでは `SessionStart` フック（`hooks/session-start.js`）が自動でこの手順の実行を促します。手動で再実行することもできます。

すでに `~/.belta/.onboarded` が存在する場合は「セットアップ済みです。やり直す場合はその旨を伝えてください」と確認してから進めてください。

> **このエージェントは「専用フォルダ限定」で使います。** ホーム直下の専用フォルダ（`~/my-agent`）を作り、**そのフォルダでだけ**プラグインを有効化（ローカルスコープ）します。グローバル（全ディレクトリ）有効化は、業務と無関係なセッションでも作法が発火してしまうため避けます。インストール時に scope を選べる場合は **Local** を選ぶよう案内してください（CLI なら `/plugin install ... --scope local`）。誤ってグローバル有効化していても、このセットアップで専用フォルダのローカル有効化に付け替えられます。

## ゴール

1. 専用フォルダ（`~/my-agent`、衝突時 `-2`…）を作成し、そのフォルダ限定でプラグインを有効化する
2. 利用者プロフィール（氏名・部署・主要業務・機密度・メール）を `~/.belta/profile.md` に保存し、部署に合わせたプライマリロール `~/.belta/roles/<slug>.md` ＋ 索引 `ROLES.md` を生成する（以降エージェントが提案で増やし・育てる）
3. MCP 4 ツール（Notion / Slack / Google Drive / GitHub）の OAuth 接続を案内・検証する
4. 完了したら `~/.belta/.onboarded` を作成し、once-only 判定を成立させる。以降は **専用フォルダを開いて**使う

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

### Step 1.6. アバター設定（任意・スキップ可）

このエージェントには「使い込むほど成長する育成アバター」がある。ここで名前と（任意で）ポートレート画像を登録すると、ダッシュボード（`/avatar`）に反映される。**任意**なので、急ぐなら飛ばしてよい（後から `/avatar setup` でいつでも設定できる）。

1. アバターの**名前**を尋ねる（未回答なら既定「あいぼう」）。
2. **画像**を尋ねる：「お好みの画像があればファイルのパスを貼り付けてください（png / jpg / webp / gif / svg・2MB 以下。任意）」。画像は育成アバターの「顔」になり、レベルが上がると周囲の枠や王冠で進化する。
3. 取得した値で次を実行（Node.js 実装、Mac / Windows 両対応。画像コピー失敗時も名前だけ保存する fail-open）。`.belta` 初期化（Step 3）より前でも後でもよいが、`avatar.yaml` はホームの `.belta` に作られる：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/avatar-setup.js" --name "<名前>" [--image "<画像の絶対パス>"]
   ```

> 画像は**あなたのパソコン内（`~/.belta/avatar/`）にのみ保存**され、外部送信されない。GitHub Pages へ公開する場合も既定で画像・名前は含めない（数値のみ）。詳細は `avatar` スキル参照。

### Step 2. 専用フォルダの作成 + ローカル有効化

このエージェント専用のフォルダを作り、**そのフォルダ限定**でプラグインを有効化します。次を実行（Node.js 実装、Mac / Windows 両対応。冪等。既に自分の専用フォルダがあれば再利用し、増殖させません）：

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agent-home.js"
```

- ホーム直下に `~/my-agent`（既に他用途で使われていれば `my-agent-2`, `my-agent-3`…）を作成し、その `<folder>/.claude/settings.local.json` に `enabledPlugins`（このプラグイン）と `extraKnownMarketplaces` を冪等マージする。これで**そのフォルダ配下で Claude Code を起動したときだけ**プラグインが有効になる。
- 出力は JSON（`{ "ok": true, "path": "<専用フォルダの絶対パス>", ... }`）。この **`path` を以降のステップで使う**ので控えておく。
- 基点やフォルダ名を変えたい場合は `--base <dir>` / `--name <folder>` / `--dir <絶対パス>`。

返ってきた `path`（＝専用フォルダの絶対パス。以下 `<AGENT_HOME>`）を、次の `.belta` 初期化で記録します。

### Step 3. `.belta` 初期化 + プロフィール保存

まず個人データ領域 `~/.belta/`（`notes/` `inbox/` `todos/` と機械可読設定 `config.yaml`）を初期化します。次を実行（Node.js 実装、Mac / Windows 両対応。atomic write + POSIX では 0o600。冪等で既存値は壊しません）：

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/belta-init.js" init --owner-email <メール> --confidentiality <公開|社外秘|極秘> --agent-home "<AGENT_HOME>"
```

- `config.yaml` には `owner_email` / `confidentiality` / `agent_home`（専用フォルダの絶対パス）/ 自動化機能のフラグ（rule/agent/skill）が入る。後から `belta-init.js set <key> <value>` で更新できる。
- `agent_home` は、後で `agent-learning` / `skill-authoring` が生成物の置き場所（`<AGENT_HOME>/.claude/agents`・`.claude/skills`）を解決するために使う、ホーム側の安定アンカー。
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

### Step 3.5. プライマリ部署ロールの生成（「部署ごとに育つ秘書」の中核）

収集した部署をもとに、部署特化の振る舞いをまとめた **プライマリロール** `~/.belta/roles/<slug>.md` と **索引** `~/.belta/roles/ROLES.md` を生成します。これにより、同じエージェントでも**部署ごとに違う既定**（典型業務・成果物の型・主担当ツール・既定の機密度）で動きます。

1. [references/roles.md](../skills/workflow/references/roles.md) を Read し、`profile.md` の `department` に一致する部署セクションを引き当てる。
2. 一致する詳細セクションがあれば、その内容（ミッション / 既定の機密度 / 主要業務 / ツール利用の傾向）を `~/.belta/roles/<slug>.md` に Write ツールで書き出す（`<slug>` は部署名の kebab-case 英字。例: 情報システム部 → `info-system`）。
3. 一致する詳細セクションが無い部署は、roles.md の **「汎用ロール雛形」** に profile.md の主要業務を流し込んで生成する（`<部署名>` と `<業務1..3>` を埋める）。
4. 索引 `~/.belta/roles/ROLES.md` を roles.md の「ROLES.md（索引）形式」に従って Write し、このロールを `primary` として 1 行記録する。
5. 生成後、次の趣旨を一言案内する：「**あなたの部署に合わせた既定**を用意しました。今後、使われ方を見ながら **私の方からロールの改善や、必要な部署ロール（マーケ・デザイン・開発など）の追加を提案していきます**。もちろん `~/.belta/roles/` を直接編集していただいても構いません」。

> ロールは**エージェント主導で育てる**（観察 → 提案 → 承認 → 反映。新設・ブラッシュアップの条件と冷却は [references/roles.md](../skills/workflow/references/roles.md)「ロールの提案と成長」）。`~/.belta/` はホームの個人データ（`.gitignore` 済み）。運営モードで索引とプライマリロールが毎セッション読み込まれる。ただし `profile.md` / `RULES.md`（rule-learning）の明示指示が優先する。Write ツールで生成するため OS 依存コマンドは不要（Mac / Windows 両対応）。

### Step 3.6. 部署の定番スキルの提案（任意・スキップ可）

生成したロールの部署に合わせて、**よく使われる既製スキル**を提案します。`claude-skills-installer` 的な「業務に合うスキルだけ入れる」を、belta のキュレート済みカタログ＋信頼判定で行います。**提案のみ**で、allowlist 内でも**サイレント導入はしません**（必ず確認を取る）。

1. カタログ照合（決定的・読み取り専用・fail-open）。`<slug>` は Step 3.5 のロール slug：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/catalog-scan.js" --department <slug> --available-only
   ```

2. 返る JSON の `candidates` から、**適合度の高い 1〜2 件に絞って** `AskUserQuestion` で提案する（一度に詰め込まない）。各候補は **提供元（source）・要求権限（required_permissions）・用途** を併記する。`catalog_available:false` ならこのステップは黙ってスキップしてよい。
3. 多くは Claude Code 同梱で「もう使える」ことが多い（`install_hint` 参照）。その場合は導入ではなく**利用案内**に切り替える。未導入かつ承認されたものだけ `/plugin install <skill>@<marketplace>`（OS 非依存）で導入する。
4. 承認/却下は `~/.belta/skills/SKILLS.md` に記録する（`skill-suggestion` スキルの SKILLS.md 形式・冷却機構と同一。詳細は [skills/skill-suggestion/SKILL.md](../skills/skill-suggestion/SKILL.md) Step 5）。

> 急ぐなら飛ばしてよい（後から `/skill-suggest` でいつでも提案を受けられる）。判断・提案ロジックの本体は `skill-suggestion` スキルにあり、このステップはその能動起動の入口（オンボ版）。

### Step 4. MCP 4 ツール接続（OAuth ベース・PAT/API キー手動コピペ不要）

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

### Step 5. permission allowlist の適用（専用フォルダへ）

このプラグインは権限ルール（allow / ask / deny）を同梱の `.claude/settings.json` で配布する。プラグイン同梱 settings がインストール先に自動マージされる環境ではこのステップは不要だが、マージが効かない環境向けに**専用フォルダの settings.local.json へ冪等マージする**フォールバックを用意している。

次を実行して適用する（Node.js 実装、Mac / Windows 両対応。既存設定は保持し、重複追加しない）。`<AGENT_HOME>` は Step 2 で得た専用フォルダの絶対パス：

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/apply-permissions.js" --target "<AGENT_HOME>/.claude/settings.local.json"
```

- `--target` で **専用フォルダのローカル設定**（プラグインを有効化したのと同じファイル）へ適用する。これで権限も「専用フォルダ限定」に揃う。
- 事前に差分だけ見たい場合は `--dry-run` を付ける。
- 適用後、`Bash(rm -rf *)` が deny、書き込み系（Slack 送信・PR 作成等）が ask、読み取り系（`gh pr list` 等）や生成物の書き込み（`Edit(.claude/agents/**)`・`Edit(.claude/skills/**)`。`Edit(...)` ルールが Write / NotebookEdit も含む全ファイル編集ツールをカバーする）が allow になることを確認する（[references/security-policies.md](../skills/workflow/references/security-policies.md) §6）。

> **MCP 接頭辞の注意**: `.claude/settings.json` の MCP ルールは `mcp__claude_ai_<Service>__*` を前提にしている。`/mcp` で列挙される実名が異なる場合は、その接頭辞に合わせて settings.local.json を調整する。PII 検知フック（`hooks/pre-tool-use.js`）は接頭辞に依存しないサフィックス判定なので、書き込み系の機密遮断はこの調整に関わらず機能する。

### Step 5.2. ガバナンス設定の適用（sandbox / MCP 許可リスト / 既定モデル）

権限ルール（Step 5）以外のガバナンス設定を専用フォルダへ届ける。中身は **サンドボックス実行**（Bash をファイル・ネットワークの境界内で動かす）・**許可 MCP のホワイトリスト**・**既定モデル**・**会話ログ保持期間**・**bypassPermissions の封鎖**。

まず `/mcp` を実行して **MCP サーバの実名**を確認する。claude.ai Connector の名前は環境によって UUID になることがあり、ホワイトリストの名前がずれると **その MCP が一切使えなくなる**（ここだけは必ず実名で合わせる）。

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/apply-governance.js" --target "<AGENT_HOME>/.claude/settings.local.json" --mcp-servers "<実名1>,<実名2>,..."
```

- `--mcp-servers` を省略すると `~/.belta/config.yaml` の `mcp_allowlist` → 同梱の既定値（`claude_ai_Notion` 等）の順に使う。確認した実名は次回以降のために記録しておく：`node "${CLAUDE_PLUGIN_ROOT}/scripts/belta-init.js" set mcp_allowlist "<実名1>,<実名2>"`
- 事前に差分だけ見たい場合は `--dry-run`。
- **サンドボックスについて一言案内する**: 「これから Bash コマンドは仮想の個室の中で動きます。読み書きできる場所と通信先をあらかじめ決めてあるので、うっかりした事故が外に広がりません。個室で動かないコマンドは、これまでどおり確認ダイアログを経て個室の外で実行できます」。
- **Windows ネイティブはサンドボックス非対応**（WSL2 内なら動く）。設定が入っていてもセッションは壊れず、従来どおりフック＋権限ルールで守られる旨を伝える。
- 適用後、`/sandbox` でサンドボックスの状態（Mode / Overrides / Config）を確認できる。macOS では追加インストール不要、Linux / WSL2 では `bubblewrap` と `socat` が必要（不足時は `/sandbox` の Dependencies タブに表示される）。

### Step 5.5. marketplace 自動更新の有効化（推奨）

プラグインを更新（作者が push + version up）したぶんを、利用者が手動更新せずに **Claude Code 起動時へ自動で届く**ようにする。次を実行（Node.js 実装、Mac / Windows 両対応。既存設定は保持し冪等）：

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/apply-auto-update.js" --target "<AGENT_HOME>/.claude/settings.local.json"
```

- 専用フォルダの settings.local.json の `extraKnownMarketplaces.<marketplace>` に `autoUpdate: true` を冪等マージする（auto-update の正規の保存先。TUI の「Enable auto-update」と同じ場所）。**権限（`permissions`）には一切触れない**ので Step 5 とは別物。
- marketplace 名と GitHub repo は同梱の `marketplace.json` から自動取得する。事前確認は `--dry-run`。
- 自動更新を望まない利用者には、このステップを飛ばしてよい旨を伝える（後から `/plugin` → Marketplaces → Enable auto-update でも有効化できる）。
- **補足（作者向け）**: auto-update は「新しい版があれば取得」する仕組みのため、作者が修正時に `plugin.json` と `marketplace.json` の `version` を上げて push しないと利用者側に更新が届かない点に注意。

### Step 6. 完了処理（once-only 確定）

すべて完了したら state file `<home>/.belta/.onboarded` を作成します。これにより次回以降のセッションで `SessionStart` フックがセットアップ案内を再注入しなくなります。

state file は **Write ツールで空ファイルとして作成** してください（親ディレクトリが無ければ作成されます）。`mkdir` / `touch` 等の POSIX コマンドは Windows で動かないため必須経路に使いません。ホームディレクトリはシェルの `~` 展開に頼らず、環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決します。

最後に、**専用フォルダで開き直す**よう必ず案内して終了します（このプラグインはそのフォルダ限定で有効なため）：

> セットアップ完了です。次回からは **`<AGENT_HOME>`（例: `~/my-agent`）を Claude Code で開いて** 話しかけてください。そのフォルダの中でだけ、内容に応じて Notion / Slack / GitHub / Google Drive へ自動で振り分けます。使うほどあなた専用にチューニングされ、覚えた専用エージェント/スキルもそのフォルダに貯まっていきます。

## 注意

- ユーザーが別の用件を明確に依頼している場合は、その用件を優先し、セットアップは後回しでよい旨を伝える（`~/.belta/.onboarded` が無い限り次回起動時に再案内される）。
- フックはあくまで「案内の自動起動」であり、ツール接続はユーザー自身の OAuth 認可操作が必要。
