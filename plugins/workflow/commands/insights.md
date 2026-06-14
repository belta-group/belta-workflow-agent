---
description: 過去の notes（日次ログ・トピックノート）を横断して振り返り（インサイト）を出す。直近何をしていたか・繰り返しているテーマ・抜け漏れを要約。
argument-hint: "[--days N] [--topic <語>]"
---

# /insights — notes 横断の振り返り

`insights` スキル（`skills/insights/SKILL.md`）を起動する入口コマンド。蓄積した `~/.belta/notes/` を横断して「直近 N 日で何をしていたか・繰り返しているテーマ・抜け漏れ」を要約する。

引数（任意）:

- `--days N` — 何日分を振り返るか（既定は `config.yaml` の `insights_default_days`、未設定なら 7）。
- `--topic <語>` — 特定テーマに絞る（その語を含む行を全 notes から拾う）。

手順はすべて `skills/insights/SKILL.md` に従う。**利用者に見せる振り返り・レポート・確認の文面はすべて日本語で出力する**（走査スクリプトのフィールド名が英語でも、まとめは日本語に翻訳する）。要点:

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/notes-scan.js" --days <N> [--topic <語>]` を Bash で実行し、走査結果 JSON を受け取る（読み取り専用・fail-open）。
2. JSON の `top_requests`（正規化キー頻度）・`sessions`・`topic_notes` を材料に、**テーマ抽出と振り返り**を日常語でまとめる。
3. 結果を `~/.belta/reports/YYYY-MM-DD-insights.md` に Write で保存し、要約を返す。
4. 強い反復傾向があれば、末尾で「この傾向を user-model.md に反映しますか？」と `AskUserQuestion` で `user-model` スキルへ橋渡しする。

> 走査対象 `~/.belta/notes/` は「あなたのパソコン内の個人フォルダ」。リポジトリには出ない。パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。
