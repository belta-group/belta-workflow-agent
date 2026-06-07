---
name: insights
description: >
  蓄積した notes（~/.belta/notes/ の日次ログ・トピックノート）を横断して、直近の
  振り返り（インサイト）を出す。「最近何してた」「振り返り」「インサイト」「まとめて教えて」
  「この N 日の動き」「○○まわりで何やってたっけ」等の発話、または /insights コマンドで
  workflow スキルから委譲される。テーマ抽出・繰り返し業務・抜け漏れの可視化を担う。
---

# 振り返り（insights）

belta は `~/.belta/notes/` に「その日の利用者依頼」を貯めている（`Stop` フック `hooks/notes-record.js` が確定記録）。本スキルはそれを **横断して振り返る** 手段を提供する。NousResearch/hermes-agent の `/insights` 相当を、SQLite/FTS5 を使わず純 Node 走査で移植したもの。

- 走査（材料抽出）: 決定的に `scripts/notes-scan.js` が担う（`hooks/repeat-util.js` の正規化を再利用し、反復検知と判定基準を揃える）。
- 意味判断（テーマ抽出・要約・抜け漏れ推定）: このスキル（LLM）が担う。

この二層は、既存の「notes-record.js（確定記録）＋ workflow スキル（能動記録）」と同じ役割分担です。

> **出力言語（必須）**: 利用者への振り返り本文・レポート（`reports/*.md`）・`AskUserQuestion` の文面・育成日記は、**すべて日本語で出力する**。走査スクリプトのフィールド名（`top_requests` 等）が英語でも、利用者に見せる文章は必ず日本語に翻訳してまとめる。

## いつ使うか（トリガ）

- `/insights [--days N] [--topic <語>]` を実行したとき
- 「最近何してた」「振り返り」「インサイト」「まとめて教えて」「先週の動き」「○○まわりで何やってたっけ」等の発話
- 運営モードで、利用者が過去の経緯・進捗の全体像を求めたとき

## ワークフロー

### Step 1: 走査（材料抽出）

1. 振り返り日数 `N` を決める。引数 `--days N` があればそれを使う。無ければ `node "${CLAUDE_PLUGIN_ROOT}/scripts/belta-init.js" get insights_default_days` で取得（未設定・失敗時は `7`）。
2. 次を Bash で実行して JSON を受け取る（読み取り専用）：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/notes-scan.js" --days <N> [--topic <語>]
   ```

   - `--topic <語>` は利用者がテーマを指定したときだけ付ける。
   - スクリプトは fail-open。notes が無ければ空の結果（`session_count: 0`）を返す。

> パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決される（スクリプト内で処理済み）。`cat` 等で notes を直接読むのではなく、このスクリプトに走査を委ねる（クロスプラットフォーム・正規化の一貫性のため）。

### Step 2: テーマ抽出と振り返り（LLM）

走査 JSON の各フィールドを材料に、**日常語の日本語で** 振り返りをまとめる（出力は必ず日本語）：

- `top_requests`（正規化キーの頻度・サンプル）→ **繰り返している業務テーマ** を抽出。完全一致でなく意図でまとめる（例: 「PRの状況確認」「議事録のNotion化」）。
- `sessions`（日付・依頼の時系列）→ **時間の流れ**（いつ何が増えたか）。
- `topic_notes`（トピックノートの見出し）→ **既に蓄積された知識の地図**。
- `topic_matches`（`--topic` 指定時）→ そのテーマに関する具体的な記録。

出力の構成（結論先出し・ピラミッド構造）：

1. **結論（1〜2 文）** — 「この N 日は主に○○と△△をしていました」。
2. **繰り返しているテーマ** — 頻度順に 3〜5 件、各 1 行。
3. **時系列の流れ** — 必要なら簡潔に。
4. **抜け漏れ・気づき** — やりかけ・放置されていそうなもの（推測は「かもしれません」と明示）。

データが乏しい（`session_count` が 0〜1）ときは無理に要約せず、「まだ振り返る材料が少ないです」と正直に返す。

### Step 3: レポート保存

振り返り本文を `~/.belta/reports/YYYY-MM-DD-insights.md` に Write で保存する（`reports/` が無ければ親ディレクトリごと作成される）。`--topic` 指定時はファイル名に含めてよい（例: `YYYY-MM-DD-insights-<topic-slug>.md`）。

> `reports/` は `notes/` の **配下に置かない**（`notes-record.js` の retention が日次ログを誤って消さないため）。`~/.belta/` 全体が `.gitignore` 対象でリポジトリには出ない。

### Step 4: user-model への橋渡し（任意）

`top_requests` に **明確に反復しているテーマ**（同一キーが複数回、または意図が同じ依頼が 3 回以上）があれば、振り返りの最後に `AskUserQuestion` で確認する：

> 「最近『○○』が繰り返し出ています。あなたの傾向として `user-model.md` に覚えておきますか？（次回以降の段取りがスムーズになります）」

- 承認 → [user-model](../user-model/SKILL.md) スキルに委譲し、この走査結果を出典として渡す。
- 「明示ルールにしたい」と言われたら [rule-learning](../rule-learning/SKILL.md) へ回す（user-model は暗黙傾向、rule-learning は明示ルール）。

### Step 5: 成長日記（avatar 連携・任意）

利用者が「成長」「アバターの育ち」「今週どれだけ育った」等を求めたとき、または週次ジョブ `belta-wf-weekly-growth` では、振り返りに **育成アバターの成長**を添える。手順は [references/growth-diary.md](references/growth-diary.md)。

- 数値は決定的に `node "${CLAUDE_PLUGIN_ROOT}/scripts/avatar-stats.js" --json` で取得（LLM 消費なし）。
- それを材料に「先週比で Lv が上がった／新バッジ獲得／継続が伸びた」を**日常語の育成日記**にして `~/.belta/reports/YYYY-MM-DD-growth-diary.md` に Write。
- 数値→意味の翻訳のみ LLM が担う（算出は [avatar](../avatar/SKILL.md) の Node スクリプト）。

## 重要な注意事項

- 走査は必ず `notes-scan.js` に委ねる（`cat`/`grep`/`sed` を必須経路に置かない。Mac / Windows 両対応・正規化の一貫性）。
- 読み取り専用。notes を書き換えない。生成物は `reports/` のみ。
- データが無いときに事実を創作しない（fail-open の精神）。
- 機密度（profile.md）を尊重し、振り返りを外部（Slack 等）へ送る場合は運営モードの確認フローに従う。

## ファイル参照

- 走査エンジン: [scripts/notes-scan.js](../../scripts/notes-scan.js)
- 正規化・notes パーサ（走査が再利用）: [hooks/repeat-util.js](../../hooks/repeat-util.js)
- 暗黙ユーザーモデルへの反映: [user-model](../user-model/SKILL.md)
- 明示ルール化: [rule-learning](../rule-learning/SKILL.md)
- 定期実行（週次の自動振り返り）: [scheduler](../scheduler/SKILL.md)
