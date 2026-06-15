---
name: feature-review
description: >
  このリポジトリ（belta-workflow-agent）の git 差分から、今回追加・変更された機能を抽出し、
  セキュリティ／テスト網羅性／単一責任／クロスプラットフォーム＋ドキュメント整合／BELTA 固有規約
  の5観点で診断する開発者向けレビュー。コミット前のセルフレビュー用。「この差分レビューして」
  「追加機能をチェック」「コミット前に確認」「差分を多観点で見て」等の発話、または /feature-review
  で起動する。SKIP: 単発の実装依頼そのもの、差分が無い純粋な質問、リリース作業（→ release スキル）。
trigger: /feature-review
---

# 差分の多観点レビュー（feature-review）

このリポジトリ**自身の開発者**が、コミット前に「今回の差分」をセルフレビューするための道具。git 差分から追加機能を抽出し、リポジトリの品質規約（`.claude/rules/**` ＋ CLAUDE.md セキュリティ4層）に照らして5観点で診断する。

- **決定的な走査・機械シグナル検出 ＝ Node スクリプト**（`scripts/diff-scan.js`）。差分取得・種別分類・禁止コマンド grep・`node --check`・frontmatter 抽出までを担う。
- **意味判断・観点ごとの評価・最終レビュー文面 ＝ このスキル（LLM）**。スクリプトのシグナルは「候補」であり、最終判定は該当ファイルを Read して裏取りしてから行う。

この二層分担は `report` / `insights` / `goal` と同じ。**配布物ではなく開発ツール**なので、`plugins/workflow/` には何も足さない。

## いつ使うか（トリガ）

- `/feature-review [--current | <branch> | --pr <n>]` を実行したとき（既定は `main` 比較）。
- 「この差分レビューして」「追加機能をチェック」「コミット前に確認」「多観点で見て」等の発話。

> SKIP: 「○○を実装して」という実装依頼そのもの（レビューではない）、差分が無い質問、リリース（→ [release](../release/SKILL.md)）。

## ワークフロー

### Step 1: 決定的走査（読み取り専用）

引数に応じて走査エンジンを呼ぶ（既定は `--base main`）。**未追跡（untracked）の新規ファイルも「全行追加」として対象に含まれる**ので、新規スキル/コマンドもレビューできる。

```
node .claude/skills/feature-review/scripts/diff-scan.js --base main
```

引数のマッピング:

| 利用者の指定 | 渡す引数 | 対象 |
| --- | --- | --- |
| （なし）/ ブランチ名なし | `--base main` | main との分岐点以降のコミット＋未コミット＋未追跡 |
| `<branch>` | `--base <branch>` | 指定ブランチ比較 |
| `--current` | `--current` | 直前コミット以降＋未コミット＋未追跡 |
| `--pr <n>` | `--pr <n>` | GitHub PR #n の差分（`gh pr diff`。未追跡は対象外） |

受け取る JSON: `files`（種別分類・status・added_lines）/ `signals`（cross_platform・permissions・pii_sync・new_hooks・failopen・version_sync・docs_anchors）/ `node_check`（構文チェック結果）/ `features`（新規 command/skill の frontmatter）。`file_count: 0` なら「レビュー対象の差分がありません」と正直に返して終了。

> パスはリポジトリルート相対。`cat`/`grep`/`sed` で差分を直接走査せず、必ずスクリプトに委ねる（クロスプラットフォーム・行番号付与の一貫性）。

### Step 2: 追加機能の抽出・要約（LLM）

`features` と、必要なら `git diff` 本文（`git diff <base>` を読む）から、**今回入った機能**を箇条書きで 1〜5 点に要約する。「何が・どこに・何のために追加されたか」を、利用者が差分を開かなくても掴める粒度で。新規ファイルだけでなく、既存ファイルへの機能追加（`files` の `M` で added_lines が多いもの）も拾う。

### Step 3: 5観点レビュー（LLM ＋ 決定的シグナルの裏取り）

[references/review-checklist.md](references/review-checklist.md) の各観点に沿って診断する。`signals` を**一次証拠**として使いつつ、決定的に拾えない設計判断（責務の妥当性・description の誤発火リスク・テスト計画の十分性・権限拡大の妥当性）は LLM が判断する。

5観点（減らさない）:
1. **セキュリティ面** — PII 3層同期 / 権限境界の拡大 / 機密データ配置 / OAuth 維持。
2. **テスト網羅性** — `node --check` / フック手動実行 / 合成シナリオ（OS両分岐・fail-open・異常入力）。
3. **単一責任** — 9カテゴリー1役割 / description の狭さ / 新規フックの正当性。
4. **クロスプラットフォーム＋ドキュメント整合** — 禁止コマンド非混入 / パス・改行の両対応 / docs アンカー・frontmatter 非破壊。
5. **BELTA 固有** — fail-open / 二層分担 / 索引整合 / version 2ファイル同期 / ブランド表記 / デザイントンマナ。

**裏取りの鉄則**（重要）:
- `signals.cross_platform` の各ヒットは、該当 `file:line` を Read し「実コードか／コメント・文字列・正規表現定義での誤検知か」を判別してから報告する。誤検知は報告に含めない（または「誤検知のため対象外」と明示）。
- `signals.permissions` / `pii_sync` は、必ず該当 `settings.json` / `.gitleaks.toml` / `pre-tool-use.js` を Read して、本当に境界が広がったか・同期が崩れたかを確認してから報告する。

### Step 4: Markdown 要約の出力（日本語）

ターミナルに Markdown で、**結論先出し**で出す。HTML は作らない。形式:

```
## レビュー結果: <base> との差分（<file_count> ファイル）

**追加された機能**
- …（Step 2 の要約）

**総評**: 🔴 N件 / 🟡 N件 / 🟢 N件

### 🔴 要修正
- `path/to/file.js:42` — <指摘>（根拠: cross-platform.md §3）
  - 直し方: <具体策>

### 🟡 要確認
- …

### 🟢 提案
- …
```

- 各指摘に **該当ファイル:行** と **根拠規約**（例: `cross-platform.md §3` / `skill-writing.md §1`）を必ず添える。
- 指摘が無い観点は「✅ 問題なし」と1行で明示し、5観点すべてに触れたことを示す。
- 重大度ゼロなら「コミット可能」と前向きに締める。
- 利用者に見せる文面はすべて**日本語**。

## 罠（Gotchas）

- **シグナルは候補、最終判定は LLM**。`diff-scan.js` の grep は誤検知する。とりわけ **`diff-scan.js` 自身**を再レビューすると、内部の正規表現定義（`/\bmkdir\s+-p\b/` 等）や文字列リテラル（`msg: "mkdir -p…"`）が cross_platform ヒットとして大量に出るが、これらは検出パターンの定義であって違反ではない。必ず該当行を Read してから報告。
- **観点を勝手に減らさない**。5観点すべてに触れる（問題なしでも明示）。利用者が「セキュリティだけ見て」と限定したときのみ絞る。
- **untracked が対象に入る**。コミット前提なので新規未追跡ファイルも「A（全行追加）」で出る。`git diff` だけ見て「差分なし」と誤判定しない（スクリプトが吸収済み）。
- **権限・PII の指摘は裏取り必須**。`settings.json`/`.gitleaks.toml`/`pre-tool-use.js` の実ファイルを読まずに「権限が広がった」と断定しない。
- **これは配布物に触れない**。レビュー結果を受けた修正提案はしてよいが、このスキル自体が `plugins/workflow/**` や `plugin.json`/`marketplace.json` を書き換えることはしない（指摘のみ。自動修正・PR コメント投稿はしない）。
- **読み取り専用**。git の書き込み操作（commit/push/add）はしない。`gh pr diff` も読み取りのみ。

## ファイル参照

- 決定的走査エンジン: [scripts/diff-scan.js](scripts/diff-scan.js)
- 5観点チェックリスト: [references/review-checklist.md](references/review-checklist.md)
- 入口コマンド: [commands/feature-review.md](../../commands/feature-review.md)
- 根拠規約: [cross-platform.md](../../rules/cross-platform.md) / [skill-writing.md](../../rules/skill-writing.md) / [doc-writing.md](../../rules/doc-writing.md) / [design.md](../../rules/design.md)
- リリース（役割分担）: [release](../release/SKILL.md)
