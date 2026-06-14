# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

BELTA 社内向けワークフロー自動化エージェント（Claude Code Plugin）。利用者向けの概要は [README.md](README.md)、フェーズ背景や実装チェックリストは [docs/tasks/tasks.md](docs/tasks/tasks.md) を参照。

## 実装ルール（必読）

プラグイン全体に適用される実装ルール。実装・レビュー時に必ず遵守すること。**最重要は「Mac / Windows 両対応」**で、OS 依存コマンド（`mkdir -p` / `cp` / `ln -s` / `cat` 等）を必須経路に置かず、Node.js の `fs` API か Claude Code 標準ツールに寄せる。

@.claude/rules/cross-platform.md

### 利用者向けドキュメント（docs/）の執筆方針

`docs/` 配下の利用者向けページを作成・改訂するときは、**非エンジニアにも一読で伝わる**ことを必須要件とする。結論先出し・認知負荷の最小化・メタファー活用・専門用語の翻訳（「日常語（専門用語）」形）・ピラミッド構造の 5 原則を守り、統一メタファーと用語グロッサリーで表記をブレさせない。既存の `##` 見出し（アンカー）を壊さず、改訂後は `npm run docs:build` で dead-link を検証すること。

@.claude/rules/doc-writing.md

### スキル（SKILL.md）の作成方針

スキルを新規作成・改訂するときは、**「ただの指示書」ではなく「スクリプト・参照知識・アセットを内包した AI 専用の道具箱（フォルダ）」** として設計する。1 スキル 1 役割（9 カテゴリーのいずれか 1 つ）・当たり前を書かない・「罠（Gotchas）」の蓄積・段階的開示（`SKILL.md` ＋ `references/` ＋ `scripts/`）・`description` は AI 向けに狭く具体的に・縛りすぎない・セットアップ値は分離して `AskUserQuestion` で補完、の各原則を守る。同梱スクリプトは `cross-platform.md` 準拠（Node.js 単一実装）。

@.claude/rules/skill-writing.md

### デザイン（トンマナ）の方針

見た目を持つ成果物（VitePress ドキュメントサイト・生成 HTML ダッシュボード・今後の UI 系生成物）は、**EC-BELTA ブランドのトンマナ**（ピンク Primary `#d76492`・淡ピンクの面・ピル型/角丸・弱い影・Noto Sans JP）に揃える。一次資料（正）は EC-BELTA リポジトリの SCSS（`~/belta/ec-belta/app/assets/scss/**`）で、値が食い違ったら SCSS 側を起点に事後同期する。チャートの系列色はカテゴリーカラーを順に使い、独自パレットを発明しない。外部 Web フォントは読み込まない（自己完結方針）。VitePress のスコープ付き CSS への上書きや派生色の作り方など、実際に踏んだ罠も下記に蓄積している。

@.claude/rules/design.md

### ブランド名の表記（表記揺れの防止）

会社・ブランドを**散文で指すときは全大文字「BELTA」**に統一する（「Belta」「belta」と書かない）。EC 側ブランドは「EC-BELTA」。対象は README・`docs/`・コード内のコメント/文字列・`plugin.json` / `marketplace.json` の `description`・コミットメッセージなど、人が読む文章すべて。

ただし**コード上の識別子・パス・固有名は原表記のまま変えない**（変えると壊れる、またはブランド表記ではないため）。具体的には: リポジトリ/パッケージ名 `belta-workflow-agent`、データフォルダ `~/.belta/`、メールドメイン `belta.co.jp`、GitHub org `belta-group`、ファイル名（`belta-init.js` 等）、JS の識別子（内部関数 `listBeltaJobs` 等）。一括置換するときは `Belta(?!Jobs)` のように識別子を除外し、JSON は置換後に妥当性を再検証する。

## リポジトリ構成

このリポジトリは 2 つの独立した部分から成る。

- **`plugins/workflow/`** — プラグイン本体（配布物）。`.claude-plugin/plugin.json` がマニフェスト。`.claude-plugin/marketplace.json`（リポジトリルート）からこのディレクトリを参照している。
- **`docs/`** — VitePress 製の利用者向けドキュメントサイト（プラグインの動作とは独立）。`docs/.vitepress/dist/` と `docs/node_modules/` は生成物。

実装を変更するのはほぼ常に `plugins/workflow/` 配下。`scripts/aggregate-token-usage.js`（ルート）は Phase 0 の実測データ集計用の独立 CLI。

## アーキテクチャ（plugins/workflow）

ユーザの業務発話を受け、Notion / Slack / GitHub / Google Drive のうち最適なツールへ分岐する。中核は **フック・スキル・コマンド** の 3 層。

> **運用モデル（最重要）**: このプラグインは **ホーム直下の専用フォルダ（`~/my-agent`、衝突時 `-2`…）限定（ローカルスコープ）でだけ有効化する** ことを既定とする。`/plugin install` の CLI 既定が User スコープ（全ディレクトリ発火）で、不慣れな利用者が業務無関係なセッションでも作法を発火させてしまう footgun を避けるため。`/workflow-setup`（`scripts/setup-agent-home.js`）が専用フォルダを作り、その `<folder>/.claude/settings.local.json` に `enabledPlugins` + `extraKnownMarketplaces` を冪等マージして局所有効化する。データ配置は **ハイブリッド**：機密データ（profile・notes・audit・config・rules）はホームの `~/.belta/`、自動生成される subagent / skill の**実体**は `<agent_home>/.claude/agents`・`.claude/skills`（索引 AGENTS.md / AUTHORED.md / SKILLS.md はホームに残す）。専用フォルダの絶対パスは `~/.belta/config.yaml` の `agent_home` に記録する。

### フック（`hooks/hooks.json` で登録、すべて Node.js 単一実装）

- **`session-start.js`（SessionStart）** — 6 つの追加コンテキストを必要時に注入。(A) 初回オンボーディングの once-only 自動起動（`~/.belta/.onboarded` が無ければ `/workflow-setup` へ誘導）。(B) **グローバル誤有効化の警告網**：`~/.claude/settings.json` の `enabledPlugins` に本プラグインがあれば（＝ユーザースコープで全ディレクトリ発火する状態）「ローカル限定運用を推奨」と警告し `/workflow-setup` での付け替えを促す。**警告のみ**で利用者設定は書き換えない（自動解除はしない）。(C) **セッションまたぎの反復検知**：直近 7 暦日の `~/.belta/notes/` を走査し、同一依頼（`repeat-util.js` の正規化キー一致）が**別々のセッションで 2 回以上**あれば、パーソナライズ提案（`agent-learning` ほか）を促す指示を注入する（決定的検知の土台＝下支え。意味判断と提案は LLM に委ねる）。(D) **セッションまたぎのハルシネーション再発検知**：`~/.belta/audit/repeat/<session>.json` に記録された訂正イベント（`repeat-util.js` の `looksLikeCorrection`）を横断集計し、同じ事実訂正が**別々のセッションで 2 回以上**あれば、事実訂正メモリ（`hallucination-memory`）への記録を促す。(E) **プラグイン更新通知**：同梱マニフェスト（`.claude-plugin/plugin.json`）の `version` を `~/.belta/plugin-version.json` の前回値と比較し、変化していれば「v旧→v新に更新」案内を**1 回だけ**注入する（通知後に記録を現行へ更新するので同一バージョンの次回以降は無出力）。記録が無い初回は基準値を黙って保存するだけ（誤って「更新」と出さない）。生成済み成果物（例: `dashboard.html`）は再生成まで古いままなので `/avatar`・`/report` 等の再実行を促す。Claude Code 右下の組み込み注意バッジは外部から書けないための代替手段。(F) **ゴール再開検知**：`~/.belta/goals/` を `hooks/goal-util.js` で走査し、進行中（`status: active`）のゴールがあれば進捗・次ステップ・停滞（7 日以上）を注入して再開提案を 1 回だけ促す（goal スキルの「セッションをまたいだ完遂」の起動側下支え。判断・実行は LLM と利用者に委ねる）。いずれも該当しなければ無出力で終了。
- **`repeat-detect.js`（UserPromptSubmit）** — **同一セッション内の反復検知**（2 系統）。`repeat-util.js` で正規化した依頼キーを、セッションごとの状態ファイル（`~/.belta/audit/repeat/<session>.json`）に **1 送信 1 件で追記**し、同一キーが**そのセッションで 2 回以上**になったらパーソナライズ提案を促す `additionalContext` を注入する。あわせて同ファイルの `corrections` 配列に**訂正イベント**（`looksLikeCorrection` が真）も 1 送信 1 件で記録し、訂正が**そのセッションで 2 回以上**になったら事実訂正メモリ（`hallucination-memory`）への記録を促す（同一訂正キーが 2 回以上なら「同じ誤りの再発」を明示）。トランスクリプト依存を避け自前カウント（二重計上しない）。スラッシュコマンド・相槌・短文・エージェント提案への選択肢回答（「1」「1を実行して」「2番で」等。`repeat-util.js` の `CHOICE_REPLY_RE`）は対象外。保持 7 日で古い状態を掃除。プロンプトは決してブロックしない（fail-open）。`session-start.js` の (C)/(D) と対で、依頼の反復と事実誤りの再発の両方を、セッション内／またぎで確定的に検知する起動側の下支え。あわせて **(3) 継続確認（長時間 / 多消費）** も毎送信チェックする：状態ファイルに刻んだ `started_at`（初回プロンプト時刻）からの経過が `continue_confirm_minutes`（既定 30 分、`config.yaml`、0 で無効）以上、または当該セッションの推計消費（`token-usage.js` の `billable_token_estimate`＝API 換算）が `continue_confirm_tokens`（既定 150000、0 で無効）以上に達したら、本格着手の前に「このまま処理を続けてよいか」を `AskUserQuestion` で確認させる `additionalContext` を注入する（決定的検知は `tokens-util.js` の `readContinueThresholds`/`readSessionBillable`、確認の実行は LLM）。時間軸（`continue_warned_at`）とトークン軸（`continue_warned_tokens`）に各々クールダウン（再アーム基準）を持たせ、しきい値ごとに最大 1 回だけ確認する（毎送信は鳴らさない）。token 値は Stop でしか書かれないため 1 応答分遅れる近似。
- **`pre-tool-use.js`（PreToolUse）** — **2 役割**。(1) **外部送信前の PII / 機密検知（deny）**：`hooks.json` の matcher で対象ツール（`Bash` / Slack・Notion・GDrive の書き込み系）に絞ったうえで、コード内でも書き込み系か再判定する。マイナンバー（12桁）・クレジットカード（Luhn）・メール一括（ユニーク5件以上）・機密ラベル・パスワードリテラルを検知すると `permissionDecision: "deny"` でブロック。(2) **許可ダイアログのやさしい説明（ask）**：PII が無く、書き込み・外部送信・確認系と判定できるコマンド/ツールに、ノンエンジニア向けの平易な説明を `permissionDecisionReason` に添えて `ask` を返す（Claude Code がこれを許可確認ダイアログに表示する。例：`curl 127.0.0.1/hoge` →「お使いのパソコン内のプログラムにアクセスします」）。説明生成は **`hooks/explain-util.js` の 3 段**に委ねる：①**辞書**（高頻度コマンドの具体文）→②**型分類**（決定的・Node。コマンドを副作用の型＝外部通信/ファイル書換/削除/権限変更/インストール/公開/履歴書換 に分類し、未知コマンドも型レベルで説明。**純読み取り・判定不能は null＝素通し**で read 系 allow を壊さない）→③**LLM フォールバック**（型は判明したが具体文が無い未知コマンドだけ `claude -p`＝haiku・MCP/ツール無効・再帰ガード `BELTA_EXPLAIN_SUBPROCESS`・タイムアウト 4s・成功は `~/.belta/cache/explain.json` にキャッシュ・失敗時は 30 分のサーキットブレーカーで遅延連発を防止。`config.yaml` の `explain_llm_fallback`＝既定 true で無効化可。OAuth を引き継げない環境＝デスクトップアプリ経由等では `claude -p` が 401 になるが、ブレーカーで型テンプレへ即フォールバック）。対象コマンドは元々 settings.json の `ask`（毎回確認）なので確認回数は増えず説明が足されるだけ。優先順位は **deny > ask > 素通し**。例外時は fail-open（無出力 `exit 0`）。
- **`token-usage.js`（Stop）** — トランスクリプトの usage を集計し、**セッション 1 ファイル**（`~/.belta/audit/tokens/<session_id>.json`、schema_version 2）に atomic に**上書き**保存（append しないので二重計上しない）。**`message.id` でデデュープする**（トランスクリプトは同一ターンをストリーミングの進行スナップショットとして複数行記録するため、全行合算だと数倍に過大計上する。同一 id は最後の行＝完全形のみ採用）。総量 4 種に加えて、`by_model`（モデル別内訳＝Opus 比率の可視化）・`by_tool`（ツール別内訳。ターン消費をそのターンの tool_use へ均等按分する**近似**。Skill/Task は `Skill:<名>`/`Task:<型>` に展開）・`slots`（5 分粒度の時系列。5 時間ゲージと日次トレンドの材料）・`limit_equiv_token_estimate`（利用制限カウント相当＝cache 読取も満額の推計。`billable_token_estimate`＝cache 読取 0.1 掛けの API 換算トークン数と併記。**どちらもトークン数であり金額ではない**ため、表示側では「課金」の語を使わず「API換算（参考）」と表記し金額誤読を防ぐ）を記録する。`scripts/token-dashboard.js` と `scripts/aggregate-token-usage.js` がこの配下を合算する。
- **`notes-record.js`（Stop）** — トランスクリプトから「その日の利用者依頼」を機械抽出し（相槌・短文・選択肢回答は `repeat-util.js` の `normalizeRequest` 判定で「依頼」から除外）、`~/.belta/notes/<YYYY-MM-DD>.md` に **1 セッション 1 行で upsert**（`[session:<id>]` 行を在れば置換／無ければ追記。LLM が書いた他行は保全）。反復検知（`rule-learning` / `agent-learning`）の土台となる notes 履歴を、LLM 任せの自動記録が漏れても確定的に残すための下支え。あわせて保持期間（既定 14 日・`config.yaml` の `notes_retention_days`、下限 7）を過ぎた**日次ログのみ**削除する（トピックノート `kebab-case.md` は残す）。

**フックの鉄則**: 例外時は決してセッションを妨げない（`exit 0` + 無出力 / fail-open）。`§7` 参照。

### スキル（`skills/*/SKILL.md`）

`workflow`（メイン分岐）/ `notion-schema`（DB 設計知識）/ `rule-learning`（発話→ルール自動蓄積）/ `agent-learning`（業務領域→専用 subagent 自動生成）/ `skill-suggestion`（既製スキルの探索・導入）/ `skill-authoring`（専門業務→専用スキルを新規自作）/ `scheduler`（自然言語の定期実行を `mcp__scheduled-tasks` に委譲して登録・管理）/ `insights`（過去 notes を横断走査して振り返りを要約）/ `report`（デイリー/ウィークリー/マンスリーの自己成長レポート。notes ＋ avatar-stats を材料に「やったこと／成長した点／次のアクション／学ぶとよいこと」を生成。insights＝過去の振り返り、report＝成長＋前向きの次アクション・学習提案、の住み分け。決定的走査＝`notes-scan.js`/`avatar-stats.js`、意味づけ・助言＝LLM）/ `user-model`（notes から観察ベースの暗黙傾向を抽出し `~/.belta/user-model.md` を深化）/ `hallucination-memory`（エージェントが犯した**事実そのものの誤り**が 2 回以上繰り返されたら、訂正済みの正しい事実を `~/.belta/memory/` に恒久記録し、毎セッション読み込んで再発を防ぐ。`rule-learning`＝振る舞い／好みの訂正に対し、こちらは**事実**の訂正という別軸）/ `token-usage`（トークン消費の可視化と利用制限対策の自己診断。`hooks/token-usage.js` の記録を `scripts/token-dashboard.js` が集計・HTML 化し、スキルは要約と省トークン助言のみ。「トークン使ってる？」「利用制限にかかった」「どの処理が重い」等の発話か `/usage` で発火）/ `goal`（複数ステップの成果物ゴールを `~/.belta/goals/<slug>.md` にチェックリストとして永続化し、順次実行・進捗記録（done/blocked）・セッションをまたいだ再開・完了アーカイブまで一貫管理。「○○を達成したい」「あのゴールの続き」等か `/goal` で発火。決定的走査＝`goal-scan.js`＋`hooks/goal-util.js`、分解・実行・書き込み＝LLM。単発依頼は workflow、当日メモは todos、定期実行は scheduler という住み分け。アーカイブはファイル移動でなく `status` 変更）。`description` の発話トリガーで発火する。

> **能動機能 3 種（hermes-agent から移植）**: scheduler（定期実行）/ insights（振り返り）/ user-model（ユーザーモデル深化）。「貯める／その場で分岐する」だけの秘書を「定期的に動き・振り返り・利用者像を深める」能動的な秘書へ拡張する。**決定的な走査・cron 生成は Node スクリプト（`scripts/notes-scan.js`・`scripts/schedule-spec.js`）、意味判断・要約・ファイル更新は LLM スキル** という二層構造（notes-record.js ＋ workflow スキルと同じ役割分担）。scheduler が insights / user-model を週次ジョブとして定期起動するハブになる。定期ジョブは会話履歴ゼロの独立セッションで動くため、ジョブ本文は `agent_home` 解決まで含む**自己完結プロンプト**にする（`skills/scheduler/references/job-templates.md`）。taskId は利用者の他用途ジョブと衝突しない `belta-wf-` プレフィクス。生成物は `~/.belta/reports/`、索引は `~/.belta/scheduler/JOBS.md`、暗黙モデルは `~/.belta/user-model.md`（`profile.md` とは分離し上書きしない）。user-model は明示ルールを自動生成せず、強い傾向は rule-learning へ橋渡しするだけ（rule-learning＝明示／user-model＝暗黙の住み分け）。`mcp__scheduled-tasks` 未提供環境では `CronCreate(durable)`→手動運用へ縮退。

> **パーソナライズ 4 機能の住み分け**: rule-learning（テキスト指示）→ agent-learning（隔離委譲する subagent）→ skill-suggestion（既製スキル導入）→ skill-authoring（専用スキル自作）。後者ほど侵襲的（自動発火し主コンテキストに載る）なので、skill-authoring は前 3 者で埋まらず専門業務が 3 回以上反復したときのみ発火する**最終手段（消去法ゲート）**。agent-learning（subagent 単一 `.md`）も skill-authoring（skill ディレクトリ）も、生成物の**実体を専用フォルダ `<agent_home>/.claude/agents`・`.claude/skills` へ直接 Write** する（ローカル限定方針と整合。`~/.claude/` へ symlink 公開していた旧方式と専用の link ヘルパーは廃止した）。索引はホーム側に残す：`~/.belta/agents/AGENTS.md`・`~/.belta/skills/AUTHORED.md`（skill-suggestion の `SKILLS.md` とは別ファイル）。生成物実体を `.claude/agents`・`.claude/skills` に置くだけでそのフォルダのセッションから自動ロードされる前提（公式ドキュメント未明記のため実機検証ゲート対象。不成立なら `~/.claude/` への公開へ戻すフォールバック）。

### コマンド（`commands/*.md`）

`/workflow`（エントリポイント、`workflow` スキルを呼ぶ）/ `/workflow-setup`（専用フォルダ作成 + ローカル有効化 → 5問オンボーディング → `scripts/belta-init.js` 実行 → `~/.belta/.onboarded` 作成 → 専用フォルダで開き直す案内）/ `/workflow-schedule`（`scheduler` スキルを呼ぶ。定期ジョブの登録/一覧/削除）/ `/insights`（`insights` スキルを呼ぶ。`[--days N] [--topic X]`）/ `/report`（`report` スキルを呼ぶ。`[daily|weekly|monthly]`、略 `d|w|m`・省略時 daily。自己成長レポート）/ `/usage`（`token-usage` スキルを呼ぶ。トークン消費ダッシュボード `~/.belta/token-dashboard.html` を再生成）/ `/goal`（`goal` スキルを呼ぶ。`[new <ゴール>|list|resume <slug>|done <slug>|archive <slug>]`、省略時 list。複数ステップゴールの登録・進捗追跡・再開）。

### スクリプト（`scripts/*.js`）

`setup-agent-home.js`（**新規**。専用フォルダ `~/my-agent[-N]` を衝突回避で作成し、`<folder>/.claude/settings.local.json` に `enabledPlugins` + `extraKnownMarketplaces` を冪等マージしてローカル有効化。`.gitignore` も冪等生成。選んだ絶対パスを JSON で返す。冪等：既存の自分の専用フォルダは再利用し増殖させない）/ `belta-init.js`（`~/.belta/` 構造と `config.yaml` を冪等生成。`agent_home` キーに専用フォルダの絶対パスを記録）/ `apply-permissions.js`（同梱 `.claude/settings.json` の permissions を、`--target <folder>/.claude/settings.local.json` で専用フォルダのローカル設定へ重複なしマージするフォールバック。`--scope user|project|local` / 自動判定も可）/ `apply-auto-update.js`（marketplace の自動更新を先回りで有効化。`extraKnownMarketplaces.<marketplace>` に `autoUpdate: true` を冪等マージ。適用先は同じく `--target` で専用フォルダへ。**`permissions` には触れない**＝権限境界の権威ソースとは別物）/ `notes-scan.js`（**新規**。`insights`・`user-model` 共用の決定的走査エンジン。`hooks/repeat-util.js` の `parseNotesSessions`/`normalizeRequest` を再利用し、直近 N 日の notes 走査・依頼頻度集計・トピックノート見出し列挙・`--topic` の includes grep・`--mode user-model` の傾向材料抽出を JSON で stdout 出力。SQLite/FTS5 非依存。fail-open）/ `schedule-spec.js`（**新規**。`scheduler` 補助。頻度語→cron 候補生成・5 フィールド cron 検証・`~/.claude/scheduled-tasks/` から `belta-wf-` ジョブ列挙。外部依存なし・fail-open。登録の実体は `mcp__scheduled-tasks` に委譲）/ `token-dashboard.js`（**新規**。`token-usage` スキルの決定的エンジン。`~/.belta/audit/tokens/` を集計し、5 時間ゲージ・日別トレンド・モデル別/ツール別内訳・セッション表を自己完結 HTML `~/.belta/token-dashboard.html` に描画。`hooks/tokens-util.js` を再利用。`--json`/`--md` で集計のみも可。v1 レコードは総量のみ合算＝fail-open）/ `goal-scan.js`（**新規**。`goal` スキルの決定的走査エンジン。`hooks/goal-util.js` のパーサ（SessionStart (F) と共用）で `~/.belta/goals/` を走査し、進捗集計・次ステップ・blocked 理由・stale（既定 7 日停滞）検知を JSON で stdout 出力。`--slug` で単一ゴールの全ステップ詳細。読み取り専用・fail-open）。

### ユーザデータと権限

- 実行時の個人データは **ハイブリッド配置**：機密データ（`profile.md` / `config.yaml` / `rules/` / `notes/` / `inbox/` / `todos/` / `goals/` / `audit/`）は利用者ホームの **`~/.belta/`** 配下、自動生成 subagent / skill の実体は専用フォルダ **`<agent_home>/.claude/agents`・`.claude/skills`**。どちらもリポジトリには含めない（`~/.belta/` は `.gitignore`、専用フォルダは setup が `.gitignore` を生成）。
- 権限境界の**単一の権威ソースは `plugins/workflow/.claude/settings.json` の `permissions`**（読み取り=allow / 書き込み=ask / 破壊的操作=deny）。`plugin.json` には permissions フィールドを置かない（プラグインマニフェストの機能ではないため）。プラグイン同梱 settings が自動マージされない環境では `apply-permissions.js` がこの権威ソースを利用者の settings.json へ反映する。**権限を変えるときはこの 1 ファイルだけを編集する。**
- 認証は全て OAuth ベース（PAT / API キーの平文保存をしない）。GitHub のみ MCP を置かず `gh` CLI を Bash 経由で呼ぶ。

## 検証・コマンド

このプラグインに従来型のビルド／テストランナーは無い。変更後の検証は以下で行う。

```bash
# フック・スクリプトの構文チェック（OS 依存処理を書いたら必須）
node --check plugins/workflow/hooks/pre-tool-use.js

# フックの手動実行（標準入力に擬似ペイロードを渡して挙動確認）
echo '{"tool_name":"mcp__slack__send_message","tool_input":{"text":"..."}}' | node plugins/workflow/hooks/pre-tool-use.js

# トークン使用量の集計（--md / --json、--since / --until）
node scripts/aggregate-token-usage.js --md

# ドキュメントサイト（docs/ 配下で）
cd docs && npm install && npm run docs:dev   # ローカルプレビュー
npm run docs:build                            # ビルド
```

OS 依存の処理を追加したら、`cross-platform.md §8` に従い合成シナリオで両 OS 分岐（フォルダ作成 / 既存再利用 / 衝突リネーム、ファイル有無、異常入力）を最低限テストする（例: `setup-agent-home.js` を一時 `HOME` で実行）。

## セキュリティ層

機密漏洩を多層で防ぐ設計。変更時はどの層に手を入れているか意識する。

1. **実行時検知** — `hooks/pre-tool-use.js`（上記）。
2. **Git 層検知** — `.gitleaks.toml` + GitHub Actions `secret-scan.yml`（PR / push 時スキャン）。`.gitleaks.toml` の allowlist には誤検知回避のため `.github/` が含まれる。
3. **権限 allowlist** — 同梱 `.claude/settings.json` の deny（`rm -rf` / `sudo` / `git push --force` / `gh repo delete` 等）。専用フォルダのローカル設定へ適用する（ローカルスコープ運用と整合）。
4. **物理除外** — 機密データは `~/.belta/`（利用者ホーム側、`.gitignore` で保護）。専用フォルダ `~/my-agent` の生成物は setup が生成する `.gitignore` で保護。
