# Phase -1 実装タスクチェックリスト

最終更新: 2026-05-30
担当: 内田氏（情報システム部）
期間: 〜2026-06-14

実装プランの詳細：`~/.claude-profiles/belta/plans/dev-cc-company-snug-hammock.md`

## Day 1: リポジトリ初期化（0.5d）

- [ ] `https://github.com/belta-group/belta-workflow-agent` private repo 作成
- [x] `.gitignore` 作成（`.belta/`, `secrets.env`, `*-credentials.json`, `oauth-token.*`）
- [x] `.claude-plugin/marketplace.json` 作成
- [x] `plugins/workflow/.claude-plugin/plugin.json` 雛形作成
- [x] `README.md` 雛形作成

## Day 2: cc-company SKILL.md 移植 + オンボーディング（1d）

- [ ] cc-company `SKILL.md` を `plugins/workflow/skills/workflow/SKILL.md` に移植
- [ ] frontmatter を `/workflow` trigger に変更
- [ ] 5 問オンボーディング実装：氏名
- [ ] 5 問オンボーディング実装：部署
- [ ] 5 問オンボーディング実装：主要業務 3 つ
- [ ] 5 問オンボーディング実装：機密度（公開／社外秘／極秘）
- [ ] 5 問オンボーディング実装：MCP 接続選択（4 ツールのチェック）
- [ ] 運営モード：発話 → 4 ツール分岐ロジック
- [ ] ブラウザ操作未インストール時の案内文追加

## Day 3-4: Notion スキーマ知識（1.5d + 0.5d）

- [ ] `notion-schema/SKILL.md` 作成
- [ ] `notion-schema-patterns.md`：Tasks パターン記述
- [ ] `notion-schema-patterns.md`：Meetings パターン記述
- [ ] `notion-schema-patterns.md`：Knowledge パターン記述
- [ ] ベストプラクティス章：正規化原則・relation 設計・Rollup 閾値
- [ ] ベストプラクティス章：DB View 3 セット・命名規約
- [ ] アンチパターン章
- [ ] `notion-property-reference.md`：title / rich_text / select の JSON Schema
- [ ] `notion-property-reference.md`：relation / formula / rollup の JSON Schema

## Day 5: 4 ツール接続（0.5d、OAuth ベース）

- [ ] `commands/workflow-setup.md` 作成
- [ ] Notion: claude.ai → Connectors → Notion 認可手順を記述
- [ ] Slack: claude.ai → Connectors → Slack 認可手順を記述
- [ ] Google Drive: claude.ai → Connectors → Google Drive 認可手順を記述
- [ ] GitHub: `gh auth login --web` 案内（device flow OAuth）を記述
- [ ] `references/mcp-setup.md` 作成（4 ツール一覧表：認証方式 / 検証コマンド）
- [ ] 検証ステップ：claude.ai Connector 3 件 → `/mcp` で列挙確認
- [ ] 検証ステップ：GitHub → `gh auth status` で `Logged in to github.com` 確認
- [ ] 検証ステップ：オンボーディング全体が 5 分以内で完了することを内田氏自身で実測

## Day 6: PII 検知フック + セキュリティポリシー（0.5d）

- [ ] `plugins/workflow/hooks/pre-tool-use.sh` 作成
- [ ] PII 正規表現：マイナンバー
- [ ] PII 正規表現：クレジットカード
- [ ] PII 正規表現：メールアドレス一括（5 件以上）
- [ ] PII 正規表現：「マル秘」「社外秘」「Confidential」
- [ ] PII 正規表現：`password\s*[:=]`
- [ ] 対象ツール設定：claude.ai Connector の **書き込み系**
  - [ ] Slack: `slack_send_message` / `slack_send_message_draft` / `slack_create_canvas` / `slack_schedule_message` / `slack_update_canvas`
  - [ ] Notion: `notion-create-*` / `notion-update-*` / `notion-create-comment` / `notion-duplicate-page` / `notion-move-pages`
  - [ ] Google Drive: `create_file` / `copy_file`
- [ ] 対象ツール設定：GitHub `gh` CLI の **書き込み系** Bash サブコマンド
  - [ ] `Bash(gh issue create *)` / `Bash(gh issue comment *)` / `Bash(gh issue edit *)`
  - [ ] `Bash(gh pr create *)` / `Bash(gh pr comment *)` / `Bash(gh pr edit *)`
  - [ ] `Bash(gh release create *)` / `Bash(gh gist create *)`
  - [ ] `Bash(gh api * --method POST|PATCH|PUT*)`
- [ ] 対象ツール設定：HTTP クライアント `Bash(curl *)` / `Bash(wget *)` / `Bash(http *)`
- [ ] `references/security-policies.md` 作成（everything-claude-code から移植）

## Day 7: permission allowlist（0.5d）

### allow（読み取り / 安全な操作）

- [ ] Read / Write(`.belta/**`)
- [ ] Bash 読み取り系：`git status`, `git log *`, `git diff *`, `git branch *`, `ls *`, `cat *`, `head *`, `tail *`
- [ ] Bash `gh` 読み取り系：`gh auth status`, `gh auth token`, `gh repo view *`, `gh repo list *`, `gh pr view *`, `gh pr list *`, `gh pr diff *`, `gh issue view *`, `gh issue list *`, `gh run list *`, `gh run view *`, `gh search *`, `gh api * --method GET*`
- [ ] Notion 読み取り系：`mcp__claude_ai_Notion__notion-search` / `notion-fetch` / `notion-query-*` / `notion-get-*`
- [ ] Slack 読み取り系：`mcp__claude_ai_Slack__slack_read_*` / `slack_search_*`
- [ ] Google Drive 読み取り系：`mcp__claude_ai_Google_Drive__search_files` / `read_file_content` / `list_recent_files` / `get_file_metadata` / `download_file_content`

### ask（書き込み / 外部影響）

- [ ] Slack 書き込み系：`slack_send_message` / `slack_send_message_draft` / `slack_schedule_message` / `slack_create_canvas` / `slack_update_canvas`
- [ ] Notion 書き込み系：`notion-create-*` / `notion-update-*` / `notion-duplicate-page` / `notion-move-pages`
- [ ] Google Drive 書き込み系：`create_file` / `copy_file`
- [ ] GitHub 書き込み系：`Bash(gh issue create|comment|edit *)` / `Bash(gh pr create|comment|edit|merge *)` / `Bash(gh release create *)` / `Bash(gh gist create *)` / `Bash(gh api * --method POST|PATCH|PUT*)`
- [ ] Git 操作系：`Bash(git push *)` / `Bash(git commit *)` / `Bash(git rebase *)` / `Bash(git merge *)` / `Bash(git reset *)`
- [ ] HTTP クライアント：`Bash(curl *)` / `Bash(wget *)` / `Bash(http *)`
- [ ] Write(`.belta/` 外)

### deny（破壊系）

- [ ] `Bash(rm -rf *)` / `Bash(sudo *)` / `Bash(chmod -R *)`
- [ ] `Bash(gh repo delete *)` / `Bash(gh pr close *)` / `Bash(gh issue close *)`
- [ ] `Bash(git push --force *)` / `Bash(git push -f *)`
- [ ] `mcp__claude_ai_Slack__*delete*`
- [ ] `mcp__claude_ai_Google_Drive__*delete*`

### 手動動作確認

- [ ] `rm -rf /tmp/test` が deny されることを確認
- [ ] `mcp__claude_ai_Slack__slack_send_message` が ask されることを確認
- [ ] `gh issue create` が ask されることを確認
- [ ] `gh pr list` が allow（プロンプトなし）で通ることを確認
- [ ] `git push --force` が deny されることを確認

## Day 8: パーソナライズ機構（1d）

- [ ] `references/profile-template.md` 作成（owner_email + 部署 + 主要業務）
- [ ] `references/roles.md` 作成（情報システム部のみ詳細）
- [ ] `.belta/` ディレクトリ初期化ロジック
- [ ] `~/.belta/config.yaml` 管理ロジック（gstack-main 流用、atomic write + 0o600）
- [ ] `~/.belta/.onboarded` state file 判定（once-only パターン）
- [ ] `notes/` / `inbox/` / `todos/` ディレクトリ生成

## Day 9: 自動ルール化 + 自動エージェント化サブスキル（1.5d）

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
- [ ] 自動化フロー：`~/.claude/agents/<slug>.md` への symlink 作成
- [ ] 自動化フロー：`AGENTS.md` に fired/adopted/deleted/rejected 記録
- [ ] 自動化フロー：起動時 symlink 健全性確認 → 切れ検知 → deleted_at 記録
- [ ] 自動化フロー：rejected 履歴管理（同領域 3 回連続却下 → 14 営業日冷却）
- [ ] `references/agent-template.md` frontmatter 雛形作成（name / description / tools / model: inherit / source_notes）
- [ ] permission 継承：親 `plugin.json` allow の部分集合のみ生成 subagent に渡すロジック
- [ ] PII フック動作確認：subagent 経由でも `hooks/pre-tool-use.sh` が発火することを手動確認
- [ ] `.belta/agents/AGENTS.md` 初期インデックス作成

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

## Day 11-12: 内田氏自身の実測（2d）

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

## Day 13-14: 社内ドッグフード + 改善（2d）

- [ ] 情シス 2〜3 名へ配布案内
- [ ] 別 PC で `/plugin marketplace add` + `/plugin install` → 5 分以内動作確認
- [ ] 各人で `/workflow-setup` 実行、MCP 4 ツール接続成功率 100% 確認
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
