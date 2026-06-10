---
name: goal
description: >
  複数ステップの成果物ゴール（例: 記事の下書き→サムネ→告知→公開前チェック→公開、
  月次レポートの作成→整形→チェック→共有）を、ステップ分解 → ~/.belta/goals/<slug>.md への
  永続化 → 順次実行 → 進捗記録（done/blocked）→ セッションをまたいだ再開 → 完了アーカイブまで
  一貫管理する。「○○を達成したい」「ゴールとして管理して」「プロジェクトとして進めたい」
  「最後までやり切って」「あのゴールの続き」「ゴールの進捗は？」等の発話、/goal コマンド、
  または SessionStart フックのゴール再開検知の注入で発火する。1 ツール・1 会話で完結する
  単発依頼（workflow 本体）、当日限りの TODO メモ（~/.belta/todos/）、定期実行の依頼
  （scheduler）には使わない。
---

# ゴール管理（goal）

belta の他機能が「その場で分岐する（workflow）」「定期的に回す（scheduler）」のに対し、本スキルは **1 回の会話で終わらない仕事を、言った後も覚えていて完遂まで面倒を見る** 手段を提供する。「AI自動化OS」6 分類の goal（複数作業を束ねて成果まで進める）に相当する。

- 走査（一覧・進捗集計・stale 検知）: 決定的に `scripts/goal-scan.js` が担う（パーサは `hooks/goal-util.js`。SessionStart の再開検知と判定基準を揃える）。
- 意味判断（ステップ分解・実行・進捗の書き込み・報告）: このスキル（LLM）が担う。

この二層は insights（`notes-scan.js` ＋ LLM）と同じ役割分担です。

> **出力言語（必須）**: 利用者への進捗報告・`AskUserQuestion` の文面・ゴールファイルの本文は、**すべて日本語で出力する**（走査 JSON のフィールド名が英語でも、利用者に見せる文章は日本語に翻訳する）。

## いつ使うか（トリガ）

- 「○○を達成したい」「ゴールとして管理して」「プロジェクトとして進めたい」「最後までやり切って」等、**複数ステップ・複数セッションにまたがりそうな成果物ゴール** の宣言
- 「あのゴールの続き」「ゴールの進捗は？」「○○どこまで進んだ？」等の再開・確認の発話
- `/goal` コマンド（`new` / `list` / `resume` / `done` / `archive`）
- SessionStart フック（`hooks/session-start.js` の (G)）が「進行中のゴールがあります」と注入したとき
- workflow スキル運営モードで、依頼が複数ステップ・複数日にまたがりそうだと判断したとき（「ゴールとして登録して進捗を追跡しましょうか？」と提案してから使う。勝手に登録しない）

**使わない場面（SKIP）**: 1 ツールで完結する単発依頼（通常の workflow 分岐で処理）／当日限りの TODO メモ（`~/.belta/todos/` に書くだけでよい）／「毎朝」「毎週」等の定期実行（scheduler スキル）。

## データ配置

- 真実のソース: `~/.belta/goals/<slug>.md`（1 ゴール 1 ファイル。書式の正本は [references/goal-format.md](references/goal-format.md)）
- 索引: `~/.belta/goals/GOALS.md`（**表示専用**。作成・進捗更新のたびに upsert するが、走査はこのファイルを読まない）

パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。`goals/` ディレクトリは Write ツールが親ごと自動作成するので `mkdir` は不要。

## ワークフロー

### Step 1: ゴール宣言の受理と分解

1. ゴール文（何が達成されたら完了か）を 1 文で確認する。曖昧なら聞き直す。
2. ゴールを **3〜10 ステップ** に分解する。各ステップは「1 回のセッションで完了確認できる粒度」（使うツールが想像できる程度に具体的に）。
3. `AskUserQuestion` でステップ案を提示し、承認・修正を受ける。
4. slug を生成する: ASCII kebab-case の短い英語（例: `monthly-sales-report`）。`node "${CLAUDE_PLUGIN_ROOT}/scripts/goal-scan.js"` の一覧で衝突を確認し、衝突したら `-2`、`-3`… を付ける。
5. [references/goal-format.md](references/goal-format.md) の雛形に従い `~/.belta/goals/<slug>.md` を Write し、`GOALS.md` に索引行を upsert する。
6. `target_date`（期日）がある場合、「期日リマインドの定期ジョブを張りますか？」と `AskUserQuestion` で確認し、希望されたら [scheduler](../scheduler/SKILL.md) へ委譲する（雛形: [references/goal-job-templates.md](references/goal-job-templates.md)）。

### Step 2: ステップ実行

1. 未着手（pending）の先頭ステップから **1 ステップずつ** 実行する。実行そのものは workflow スキルの 4 ツール分岐（Notion / Slack / GitHub / Google Drive）と同じ作法に従う: 書き込み系は実行前に要約確認、機密度（profile.md）を尊重、PII フックの指摘に従う。
2. ステップが完了したら **その都度** ゴールファイルを Edit する:
   - チェックボックスを `- [x]` にし、行末に `<!-- done:YYYY-MM-DD -->` を付ける
   - frontmatter の `updated_at` を当日に更新する
   - `GOALS.md` の索引行（steps:done/total / updated）を upsert する
3. ステップが進められない（承認待ち・情報不足・外部要因）ときは `- [!]` にし、行末に `<!-- blocked:理由 -->` を付けて理由を残す。`updated_at` も更新する。
4. 利用者が会話を切り上げる・別の用件に移るときは、現在の進捗（done/total と次のステップ）を一言で要約して終える。「途中保存」の操作は不要（ファイルが常に最新になっているのが正しい状態）。

### Step 3: 再開（セッションまたぎ）

1. 必ず最初に走査して現状を取得する（記憶や推測で進めない）:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/goal-scan.js" --slug <slug>
   ```

2. 進捗（done/total）・次のステップ・blocked の有無を日本語で報告する。
3. blocked ステップがあれば、解消したか（承認が下りたか・情報が揃ったか）を確認する。解消していれば `- [ ]` に戻して続行、未解消ならスキップして次の pending へ進めるか利用者に確認する。
4. 以降は Step 2 と同じ。

### Step 4: 完了とアーカイブ

1. 全ステップが done になったら frontmatter を `status: done` に更新し、完了を報告する（何が達成されたかを 1〜2 文で）。
2. 「このゴールをアーカイブしますか？（一覧から非表示になります）」と `AskUserQuestion` で確認し、承認されたら `status: archived` に更新する。**ファイルは移動・削除しない**（status 変更のみ。クロスプラットフォーム規約と監査性のため）。
3. 利用者が途中で「このゴールはもうやめる」と言ったときも同様に `status: archived` にする（ステップは未完了のままでよい）。

## 既存機能との住み分け・連携

| 相手 | 関係 |
| --- | --- |
| `~/.belta/todos/` | todos は**当日限りの単発メモ**（日次ファイル、追跡なし）。複数ステップを束ねて完遂まで追うなら goal。迷ったら「明日も続きをやるか？」で判定（やるなら goal）。 |
| [scheduler](../scheduler/SKILL.md) | 期日リマインド・週次のゴール棚卸しを定期ジョブとして張れる（[references/goal-job-templates.md](references/goal-job-templates.md)）。goal 自体は定期実行しない。 |
| [insights](../insights/SKILL.md) / [report](../report/SKILL.md) | `goal-scan.js` の JSON を振り返り・成長レポートの材料に使える（読み取り専用なので自由に呼んでよい）。 |
| workflow スキル | 各ステップの実行は workflow の分岐ロジック・安全層（PII フック・permissions・機密度確認）をそのまま通る。goal は新しい権限を獲得しない。 |

## 罠（Gotchas）

- **再開時に再分解しない。** 既存ゴールは必ず `goal-scan.js --slug` を先に実行し、記録済みのステップに従う。LLM の記憶でステップを作り直すと進捗が壊れる。
- **チェックボックスは 3 状態のみ**: `- [ ]` / `- [x]` / `- [!]`。`- [~]` や `- [WIP]` 等の独自記法を発明しない（パーサ `hooks/goal-util.js` が読めなくなる）。
- **`## ステップ` 見出しの配下以外にチェックボックスを書かない。** パーサは `## ステップ` から次の `##` までしか数えないが、メモ欄のチェックボックスは利用者を混乱させる。
- **進捗を書いたら必ず frontmatter の `updated_at` も更新する。** これが stale（7 日停滞）検知の基準。忘れると放置ゴールとして誤検知される。
- **`GOALS.md` は表示専用。** 進捗の判定に使わない・真実のソースにしない（古くても実害が出ない設計）。
- **ゴールファイルに機密値（トークン・パスワード・個人情報）を直書きしない。** 「○○の認証情報を使う」等の参照に留める。
- **アーカイブはファイル移動ではなく `status: archived`。** `mv` / `rm` を必須経路に置かない（cross-platform.md）。
- **`done:` / `blocked:` コメントの書式を崩さない**（`<!-- done:YYYY-MM-DD -->` / `<!-- blocked:理由 -->`）。理由に `-->` を含めない。

## ファイル参照

- 書式の正本・雛形: [references/goal-format.md](references/goal-format.md)
- 走査エンジン: [scripts/goal-scan.js](../../scripts/goal-scan.js)
- 共有パーサ（SessionStart 再開検知と共用）: [hooks/goal-util.js](../../hooks/goal-util.js)
- scheduler 連携の定期ジョブ雛形: [references/goal-job-templates.md](references/goal-job-templates.md)
