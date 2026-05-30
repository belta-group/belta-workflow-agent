# Phase -1 実装タスクチェックリスト

最終更新: 2026-05-30
担当: 内田氏（情報システム部）
期間: 〜2026-06-14

実装プランの詳細：`~/.claude-profiles/belta/plans/dev-cc-company-snug-hammock.md`

## Day 1: リポジトリ初期化（0.5d）

- [x] `https://github.com/belta-group/belta-workflow-agent` private repo 作成
- [x] `.gitignore` 作成（`.belta/`, `secrets.env`, `*-credentials.json`, `oauth-token.*`）
- [x] `.claude-plugin/marketplace.json` 作成
- [x] `plugins/workflow/.claude-plugin/plugin.json` 雛形作成
- [x] `README.md` 雛形作成

## Day 2: cc-company SKILL.md 移植 + オンボーディング（1d）

- [x] cc-company `SKILL.md` を `plugins/workflow/skills/workflow/SKILL.md` に移植
- [x] frontmatter を `/workflow` trigger に変更
- [x] 5 問オンボーディング実装：氏名
- [x] 5 問オンボーディング実装：部署
- [x] 5 問オンボーディング実装：主要業務 3 つ
- [x] 5 問オンボーディング実装：機密度（公開／社外秘／極秘）
- [x] 5 問オンボーディング実装：OAuth 接続選択（4 ツールのチェック。claude.ai Connector OAuth: Notion / Slack / Google Drive、gh CLI OAuth: GitHub）
- [x] 運営モード：発話 → 4 ツール分岐ロジック
- [x] ブラウザ操作未インストール時の案内文追加

## Day 3-4: Notion スキーマ知識（1.5d + 0.5d）

- [x] `notion-schema/SKILL.md` 作成
- [x] `references/patterns/tasks.md`：Tasks パターン記述（省トークン化でパターン単位に分割）
- [x] `references/patterns/meetings.md`：Meetings パターン記述
- [x] `references/patterns/knowledge.md`：Knowledge パターン記述
- [x] `references/best-practices.md`：正規化原則・relation 設計・Rollup 閾値
- [x] `references/best-practices.md`：DB View 3 セット・命名規約
- [x] `references/best-practices.md`：アンチパターン章
- [x] `notion-property-reference.md`：title / rich_text / select の型構文（DDL）+ JSON 値（※接続中 MCP は REST JSON Schema でなく SQL DDL。REST JSON は付録に併記）
- [x] `notion-property-reference.md`：relation / formula / rollup の型構文（DDL）+ JSON 値（同上）

## Day 5: 4 ツール接続（0.5d、OAuth ベース）

- [x] `commands/workflow-setup.md` 作成
- [x] 初回セットアップ自動起動（`hooks/hooks.json` + `hooks/session-start.js`、SessionStart once-only。インストール時フックが無いための代替。Node.js 実装で Mac / Windows 両対応）
- [x] Notion: claude.ai → Connectors → Notion 認可手順を記述
- [x] Slack: claude.ai → Connectors → Slack 認可手順を記述
- [x] Google Drive: claude.ai → Connectors → Google Drive 認可手順を記述
- [x] GitHub: `gh auth login --web` 案内（device flow OAuth）を記述
- [x] `references/mcp-setup.md` 作成（4 ツール一覧表：認証方式 / 検証コマンド）
- [x] 検証ステップ：claude.ai Connector 3 件 → `/mcp` で列挙確認（手順を記述）
- [x] 検証ステップ：GitHub → `gh auth status` で `Logged in to github.com` 確認（手順を記述）
- [ ] 検証ステップ：オンボーディング全体が 5 分以内で完了することを内田氏自身で実測

## Day 6: PII 検知フック + セキュリティポリシー（0.5d）

- [x] `plugins/workflow/hooks/pre-tool-use.js` 作成（Node.js 実装で Mac / Windows 両対応）
- [x] PII 正規表現：マイナンバー（12 桁。16 桁 CC との二重検出を境界で除外）
- [x] PII 正規表現：クレジットカード（16 桁 + Luhn 検証で誤検知抑制）
- [x] PII 正規表現：メールアドレス一括（ユニーク 5 件以上）
- [x] PII 正規表現：「マル秘」「㊙」「社外秘」「Confidential」
- [x] PII 正規表現：`password\s*[:=]`
- [x] 対象ツール設定：claude.ai Connector の **書き込み系**
  - [x] Slack: `slack_send_message` / `slack_send_message_draft` / `slack_create_canvas` / `slack_schedule_message` / `slack_update_canvas`
  - [x] Notion: `notion-create-*` / `notion-update-*` / `notion-create-comment` / `notion-duplicate-page` / `notion-move-pages`
  - [x] Google Drive: `create_file` / `copy_file`
- [x] 対象ツール設定：GitHub `gh` CLI の **書き込み系** Bash サブコマンド
  - [x] `Bash(gh issue create *)` / `Bash(gh issue comment *)` / `Bash(gh issue edit *)`
  - [x] `Bash(gh pr create *)` / `Bash(gh pr comment *)` / `Bash(gh pr edit *)`
  - [x] `Bash(gh release create *)` / `Bash(gh gist create *)`
  - [x] `Bash(gh api * --method POST|PATCH|PUT*)`
- [x] 対象ツール設定：HTTP クライアント `Bash(curl *)` / `Bash(wget *)` / `Bash(http *)`
- [x] `references/security-policies.md` 作成（everything-claude-code から移植 + Belta 文脈に再構成）

## Day 6.5: 省トークン施策（reference 粒度 + トークン使用量ログ）

### reference 粒度の細分化（不要ロード削減）

- [x] `notion-schema-patterns.md`（231 行・3 パターン同梱）を `references/patterns/{tasks,meetings,knowledge}.md` に分割
- [x] 共通ベストプラクティス・アンチパターンを `references/best-practices.md` に分離
- [x] `notion-property-reference.md` 末尾の REST API 付録を `references/notion-rest-api-appendix.md` に分離（例外時のみロード）
- [x] `notion-schema/SKILL.md` の選定表を「該当 1 パターンだけ Read」に更新（全体クロスリファレンス修正）
- [ ] 実測：Tasks DB 設計 1 件で読み込まれる reference 行数が分割前（231 行）→ 分割後（パターン 1 つ約 55 行）に減ることを確認

### トークン使用量ログ（Phase 0 実測データ用）

- [x] `plugins/workflow/hooks/token-usage.js` 作成（Stop フック。Node.js 実装で Mac / Windows 両対応）
- [x] トランスクリプト JSONL から usage（input / output / cache_creation / cache_read）を集計
- [x] セッション単位ファイル `~/.belta/audit/tokens/<session_id>.json` に上書き保存（append 肥大なし）
- [x] 課金相当の概算（cache_read を 0.1 掛け）算出
- [x] 例外時も無出力 exit 0（Stop 判断に介入しない）
- [x] `hooks/hooks.json` に Stop フック登録
- [x] 合成トランスクリプトで集計・session_id サニタイズ・異常入力耐性を確認
- [x] `~/.belta/audit/tokens/` 配下を合算する集計スクリプト `scripts/aggregate-token-usage.js` を作成（テキスト表 / `--md` / `--json` 出力、Node.js / Mac・Windows 両対応）
- [ ] ドッグフード期間終了後、`node scripts/aggregate-token-usage.js --md` の出力を `data/phase-minus-1/before-after.md`（トークン消費量）に貼り付け

## Day 7: permission allowlist（0.5d）

> **配置先の変更**: `plugin.json` には permissions フィールドが存在しない（Claude Code 公式仕様）ため、プラン記載の「plugin.json に記述」は不可。代わりに **同梱 `.claude/settings.json`（権威ソース）+ `scripts/apply-permissions.js`（利用者 settings へ冪等マージするフォールバック）** の二重化で実装（ユーザー承認済み）。文字列は公式の `Bash(cmd:*)` 形式に正規化。precedence は deny > ask > allow、どのルールにも合致しない操作は既定 ask。

### allow（読み取り / 安全な操作）

- [x] Read / Write(`.belta/**`)
- [x] Bash 読み取り系：`git status`, `git log *`, `git diff *`, `git branch *`, `ls *`, `cat *`, `head *`, `tail *`
- [x] Bash `gh` 読み取り系：`gh auth status`, `gh auth token`, `gh repo view *`, `gh repo list *`, `gh pr view *`, `gh pr list *`, `gh pr diff *`, `gh issue view *`, `gh issue list *`, `gh run list *`, `gh run view *`, `gh search *`, `gh api * --method GET*`
- [x] Notion 読み取り系：`mcp__claude_ai_Notion__notion-search` / `notion-fetch` / `notion-query-*` / `notion-get-*`
- [x] Slack 読み取り系：`mcp__claude_ai_Slack__slack_read_*` / `slack_search_*`
- [x] Google Drive 読み取り系：`mcp__claude_ai_Google_Drive__search_files` / `read_file_content` / `list_recent_files` / `get_file_metadata` / `download_file_content`

### ask（書き込み / 外部影響）

- [x] Slack 書き込み系：`slack_send_message` / `slack_send_message_draft` / `slack_schedule_message` / `slack_create_canvas` / `slack_update_canvas`
- [x] Notion 書き込み系：`notion-create-*` / `notion-update-*` / `notion-duplicate-page` / `notion-move-pages`
- [x] Google Drive 書き込み系：`create_file` / `copy_file`
- [x] GitHub 書き込み系：`Bash(gh issue create|comment|edit *)` / `Bash(gh pr create|comment|edit|merge *)` / `Bash(gh release create *)` / `Bash(gh gist create *)` / `Bash(gh api * --method POST|PATCH|PUT*)`
- [x] Git 操作系：`Bash(git push *)` / `Bash(git commit *)` / `Bash(git rebase *)` / `Bash(git merge *)` / `Bash(git reset *)`
- [x] HTTP クライアント：`Bash(curl *)` / `Bash(wget *)` / `Bash(http *)`
- [x] Write(`.belta/` 外)（明示 ask は precedence 上 `.belta` を巻き込むため置かず、既定 ask で実現）

### deny（破壊系）

- [x] `Bash(rm -rf *)` / `Bash(sudo *)` / `Bash(chmod -R *)`
- [x] `Bash(gh repo delete *)` / `Bash(gh pr close *)` / `Bash(gh issue close *)`
- [x] `Bash(git push --force *)` / `Bash(git push -f *)`
- [x] `mcp__claude_ai_Slack__*delete*`
- [x] `mcp__claude_ai_Google_Drive__*delete*`
- [x] `.env` の中身は絶対に読み取らない（`Read(.env)` / `Read(**/.env)` / `Read(.env.*)` を deny。`Bash(cat *.env*)` / `Bash(cat *.env)` 等の経由読み取りも deny）

### 手動動作確認

- [ ] `rm -rf /tmp/test` が deny されることを確認
- [ ] `mcp__claude_ai_Slack__slack_send_message` が ask されることを確認
- [ ] `gh issue create` が ask されることを確認
- [ ] `gh pr list` が allow（プロンプトなし）で通ることを確認
- [ ] `git push --force` が deny されることを確認
- [ ] `.env` の読み取り（`Read(.env)` / `cat .env`）が deny されることを確認

## Day 8: パーソナライズ機構（1d）

- [ ] `references/profile-template.md` 作成（owner_email + 部署 + 主要業務）
- [ ] `references/roles.md` 作成（情報システム部のみ詳細）
- [ ] `.belta/` ディレクトリ初期化ロジック
- [ ] `~/.belta/config.yaml` 管理ロジック（gstack-main 流用、atomic write + 0o600）
- [x] `~/.belta/.onboarded` state file 判定（once-only パターン。`session-start.js` で読み取り判定、`workflow-setup` 完了時に作成）
- [ ] `notes/` / `inbox/` / `todos/` ディレクトリ生成

## Day 9: 自動ルール化 + 自動エージェント化 + 自動スキル提案サブスキル（2d）

### rule-learning（プラン §6-1）

- [ ] `skills/rule-learning/SKILL.md` 作成
- [ ] 検知トリガ：発話フレーズ検出（「次回からは」「毎回」等）
- [ ] 検知トリガ：同じ訂正パターン 2 回以上検知ロジック
- [ ] 検知トリガ：非自明な選択肢採用後の確認発話
- [ ] 自動化フロー：「ルール化しますか？」確認ダイアログ
- [ ] 自動化フロー：個別 .md 保存ロジック
- [ ] 自動化フロー：`RULES.md` インデックス追記ロジック
- [ ] 自動化フロー：rejected 履歴管理（3 回目までは再提案しない）
- [ ] `references/rule-template.md` frontmatter 雛形作成
- [ ] `.belta/rules/RULES.md` 初期インデックス作成

### agent-learning（プラン §6-2、Q1=b / Q2=5 営業日 2 回 / Q3=計画どおり）

- [ ] `skills/agent-learning/SKILL.md` 作成
- [ ] 検知トリガ：直近 5 営業日の `.belta/notes/` 走査ロジック
- [ ] 検知トリガ：同一業務領域 2 回検出（LLM ラベル判定）
- [ ] 自動化フロー：「`<slug>` を専用エージェント化しますか？」確認ダイアログ
- [ ] 自動化フロー：`~/.belta/agents/<slug>.md` 生成ロジック
- [ ] 自動化フロー：生成エージェントの業務カテゴリ判定 → モデル選択ポリシー（haiku / sonnet / inherit の 3 段、[references/agent-template.md](../plugins/workflow/skills/agent-learning/references/agent-template.md)）に従い `model` を決定（`inherit` 固定にしない）
- [ ] 自動化フロー：`~/.claude/agents/<slug>.md` への symlink 作成
- [ ] 自動化フロー：`AGENTS.md` に fired/adopted/deleted/rejected 記録
- [ ] 自動化フロー：起動時 symlink 健全性確認 → 切れ検知 → deleted_at 記録
- [ ] 自動化フロー：rejected 履歴管理（同領域 3 回連続却下 → 14 営業日冷却）
- [x] `references/agent-template.md` frontmatter 雛形作成（name / description / tools / model / source_notes）＋モデル選択ポリシー（haiku / sonnet / inherit の 3 段。`inherit` 固定にせず業務カテゴリで出し分け）
- [ ] permission 継承：親 `plugin.json` allow の部分集合のみ生成 subagent に渡すロジック
- [ ] PII フック動作確認：subagent 経由でも `hooks/pre-tool-use.sh` が発火することを手動確認
- [ ] `.belta/agents/AGENTS.md` 初期インデックス作成

### skill-suggestion（業務効率化スキルの自動提案・インストール、プラン §6-3）

- [ ] `skills/skill-suggestion/SKILL.md` 作成
- [ ] 検知トリガ：既存スキルでカバーできない非効率な手作業の繰り返し検出（例：PDF 抽出・スプレッドシート集計・議事録要約・スライド作成）
- [ ] 検知トリガ：能力探索フレーズ検出（「〜できる？」「〜のやり方」「もっと楽に」「自動化できない？」等）
- [ ] 検知トリガ：同種タスク 2 回以上 × 主要業務（プロフィール）との照合で適合スキルを推定
- [ ] 候補探索：`find-skills` スキル経由でインストール可能スキルを検索
- [ ] 候補探索：インストール済みスキル一覧と利用可能候補の突合（重複提案を抑止）
- [ ] 信頼ソース allowlist：社内 marketplace（`belta-group/*`）+ Anthropic 公式のみ自動インストール対象とし、出典・提供元・要求権限を提示
- [ ] 自動化フロー：「`<skill>` を導入すると効率化できます。インストールしますか？」確認ダイアログ（要求権限・提供元を併記）
- [ ] 自動化フロー：`/plugin install`（または skill 配置）実行ロジック（Node.js 実装で Mac / Windows 両対応）
- [ ] 自動化フロー：インストール後の有効化・読み込み確認（`/plugin` または skill 一覧で存在確認）
- [ ] 自動化フロー：`SKILLS.md` に suggested/installed/rejected/uninstalled 記録
- [ ] 自動化フロー：rejected 履歴管理（同一スキル 3 回連続却下 → 14 営業日冷却）
- [ ] セキュリティ：未審査・allowlist 外スキルは自動インストール禁止（提案のみに留め、手動導入を案内）
- [ ] セキュリティ：インストール直後の新規スキルにも `hooks/pre-tool-use.js`（PII 検知）が適用されることを確認
- [ ] `references/skill-allowlist.md` 作成（許可 marketplace / 提供元 / 既定推奨スキル一覧）
- [ ] `.belta/skills/SKILLS.md` 初期インデックス作成

## Day 10: Git 層漏洩防止（0.5d）

- [ ] `.gitleaks.toml` 作成
- [ ] gitleaks ルール：マイナンバー
- [ ] gitleaks ルール：クレジットカード
- [ ] gitleaks ルール：メールアドレス一括
- [ ] gitleaks ルール：パスワードリテラル
- [ ] gitleaks ルール：「マル秘」「社外秘」「Confidential」
- [ ] gitleaks ルール：`@belta.co.jp` ドメイン
- [ ] gitleaks ルール：標準 API キーパターン継承
- [ ] `.github/workflows/secret-scan.yml` 作成（gitleaks Action v2）
- [ ] テスト用 PR で 6 種検知パターン commit → 全件 fail 確認
- [ ] 通常コード 10 件で誤検知 0 件確認

## Day 11-12: テスト（2d）

- [ ] 自部署 Notion スキーマ設計業務で Toggl Track 開始
- [ ] 自部署 週次ワークフロー改善業務で Toggl Track 開始
- [ ] Before データ 1 週間分取得
- [ ] エージェント運用開始
- [ ] After データ取得
- [ ] 週削減時間 1.0 時間以上を確認
- [ ] 検知トリガフレーズを意図的に 3 回発話 → ルール化提案動作確認
- [ ] 同じ訂正を 2 回 → ルール化提案動作確認
- [ ] 自動ルール化 5 件以上発火、3 件以上採用を確認
- [ ] 同一業務領域の発話を 5 営業日内に 2 回 → エージェント化提案動作確認
- [ ] 自動エージェント化 1 件以上発火・採用、symlink 健全性 OK を確認
- [ ] `~/.claude/agents/<slug>.md` を手動削除 → `AGENTS.md` に deleted_at が記録されることを確認
- [ ] 能力探索フレーズ（例：「PDF から表を抽出できる？」）を発話 → スキル提案動作確認
- [ ] 提案スキルを承認 → 自動インストール成功 + `SKILLS.md` に installed 記録を確認
- [ ] allowlist 外スキルが自動インストールされず提案のみに留まることを確認

- [ ] 情シス 2〜3 名へ配布案内
- [ ] 別 PC で `/plugin marketplace add` + `/plugin install` → 5 分以内動作確認
- [ ] 各人で `/workflow-setup` 実行、4 ツール OAuth 接続成功率 100% 確認
- [ ] PII 検知サンプル各 3 件投入で全件遮断確認
- [ ] PII 検知通常テキスト 20 件で誤検知 1 件以下確認
- [ ] gitleaks Action が意図的 PII commit 100% ブロック確認
- [ ] 簡易アンケート（5 段階評価 + 自由記述）実施
- [ ] 致命バグ対応
- [ ] Phase 1 配布 Go 判定 9 項目の評価

## Phase 0 経営承認準備（2026-06-10）

- [ ] `data/phase-minus-1/before-after.md` に実測ログ集約
- [ ] `data/phase-minus-1/rule-learning-log.md` に発火・採用履歴集約
- [ ] `data/phase-minus-1/dogfood-survey.md` にアンケート結果集約
- [ ] Phase 0 経営承認会議用資料に添付
- [ ] 配布形態の最終決定（Plugin / Skills / Projects のいずれか）
- [ ] Phase 1（パイロット 20 名配布）の Go / Pivot / Kill 判定提示

---

## Phase 1 配布後に回す（MVP に含めない）

- [ ] 残り 3 Notion パターン（Decisions / Deals / Incidents）追加
- [ ] 残り 7 部署の `roles.md` 詳細化
- [ ] PII 検知パターン拡充（社内固有 ID 等）
- [ ] 監査ログ CSV 出力（社外提出要求が出た場合）
- [ ] `/workflow-doctor` 環境診断（運用上の苦情が出た場合）
- [ ] `packages/dashboard/` 可視化（Phase 4 全社展開時）
- [ ] ブラウザ操作スキル独立 Plugin 化

## VitePress 利用ガイド整備（配布後・利用方法ドキュメント）

利用者向けにこのプラグインの使用方法を VitePress で静的サイト化する。

- [ ] VitePress 導入（`docs/` 配下に `package.json` + `npm i -D vitepress`、Node.js ベースで Mac / Windows 両対応）
- [ ] `docs/.vitepress/config.*` 作成（サイトタイトル / nav / sidebar 構成）
- [ ] トップページ：プラグイン概要・対象利用者・前提環境
- [ ] 導入手順：`/plugin marketplace add` → `/plugin install` → `/workflow-setup`（初回 5 分セットアップ）
- [ ] 4 ツール OAuth 接続手順（Notion / Slack / Google Drive / GitHub）の利用者向け解説
- [ ] `/workflow` 基本的な使い方（発話例 → 4 ツール分岐の利用イメージ）
- [ ] 自動ルール化 / 自動エージェント化 / 自動スキル提案の使い方と承認フロー
- [ ] PII 検知・permission（allow / ask / deny）の挙動と利用者から見た注意点
- [ ] トラブルシューティング / FAQ
- [ ] ローカルプレビュー（`npm run docs:dev`）と静的ビルド（`npm run docs:build`）の動作確認（Mac / Windows 両 OS）
- [ ] GitHub Pages 公開設定（リポジトリ Settings → Pages を GitHub Actions ソースに設定）
- [ ] VitePress の `base` を GitHub Pages の公開パス（`/belta-workflow-agent/`）に合わせて設定
- [ ] `.github/workflows/docs.yml` 作成（`docs:build` → `actions/deploy-pages` で自動デプロイ）
- [ ] private repo での GitHub Pages 公開範囲・アクセス制御の確認（社外秘ドキュメントのため公開設定を要精査）
