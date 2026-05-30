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

## Day 5: MCP 4 ツール接続（0.5d）

- [ ] `commands/workflow-setup.md` 作成
- [ ] Notion MCP add コマンド記述
- [ ] Slack MCP add コマンド記述
- [ ] GitHub MCP add コマンド記述
- [ ] Google Drive MCP add コマンド記述
- [ ] `references/mcp-setup.md` 作成（表形式参考）
- [ ] `~/.belta/secrets.env` 保存ロジック実装
- [ ] `claude mcp list` での結果検証ステップ追加

## Day 6: PII 検知フック + セキュリティポリシー（0.5d）

- [ ] `plugins/workflow/hooks/pre-tool-use.sh` 作成
- [ ] PII 正規表現：マイナンバー
- [ ] PII 正規表現：クレジットカード
- [ ] PII 正規表現：メールアドレス一括（5 件以上）
- [ ] PII 正規表現：「マル秘」「社外秘」「Confidential」
- [ ] PII 正規表現：`password\s*[:=]`
- [ ] 対象ツール設定：`mcp__slack__*` / `mcp__notion__*` / `Bash(curl *)`
- [ ] `references/security-policies.md` 作成（everything-claude-code から移植）

## Day 7: permission allowlist（0.5d）

- [ ] `plugin.json` allow セクション記述（Read / Write(.belta/**) / mcp__notion__* 等）
- [ ] `plugin.json` ask セクション記述（mcp__slack__send_* / Bash(curl *) 等）
- [ ] `plugin.json` deny セクション記述（Bash(rm -rf *) / Bash(sudo *) 等）
- [ ] `rm -rf /tmp/test` が deny されることを手動確認
- [ ] `mcp__slack__send_message` が ask されることを手動確認

## Day 8: パーソナライズ機構（1d）

- [ ] `references/profile-template.md` 作成（owner_email + 部署 + 主要業務）
- [ ] `references/roles.md` 作成（情報システム部のみ詳細）
- [ ] `.belta/` ディレクトリ初期化ロジック
- [ ] `~/.belta/config.yaml` 管理ロジック（gstack-main 流用、atomic write + 0o600）
- [ ] `~/.belta/.onboarded` state file 判定（once-only パターン）
- [ ] `notes/` / `inbox/` / `todos/` ディレクトリ生成

## Day 9: 自動ルール化サブスキル（1d）

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
