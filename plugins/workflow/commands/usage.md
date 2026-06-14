---
description: トークン消費の可視化。どの処理（ツール・スキル・モデル）にどれだけトークンを使ったかを集計し、直近5時間の消費ゲージ付きのローカル HTML ダッシュボードを再生成する。利用制限（5時間ごとの上限）対策の自己診断用。
argument-hint: ""
---

# /usage — トークン消費ダッシュボード

`token-usage` スキル（`skills/token-usage/SKILL.md`）を起動する入口コマンド。`~/.belta/audit/tokens/` に貯まったセッション別のトークン記録から、消費の内訳（モデル別・処理別・日別・セッション別）と直近 5 時間のローリング消費を集計し、自己完結の HTML ダッシュボード（`~/.belta/token-dashboard.html`）を再生成する。

手順はすべて `skills/token-usage/SKILL.md` に従う。要点:

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/token-dashboard.js" --md` で集計サマリを取得（決定的・fail-open・LLM 消費なし）。
2. `node "${CLAUDE_PLUGIN_ROOT}/scripts/token-dashboard.js"` で `~/.belta/token-dashboard.html` を再生成。
3. 会話には結論（直近 5 時間の消費と重い処理 上位）を先に短く要約し、必要なら省トークンの助言を 1〜2 点添える。OS の open コマンドは打たない。
   - **【必須】ダッシュボードの案内は、`token-dashboard.js` 出力の `markdown` の値（`[⚡ トークン消費ダッシュボードを開く](file://…)`）を、そのまま 1 行で出力して締めること。** 生のファイルパスを本文に書いてはいけない。`markdown` が空のときだけ `out` のパスを文言で案内（fail-open）。

> 数値は**このエージェントのセッション分だけの推計**で、Claude の公式の利用制限カウントそのものではない（他プロジェクトや claude.ai の利用分は含まれない）。ダッシュボードは「あなたのパソコン内の個人フォルダ（`~/.belta/`）」に生成され、外部送信されない。パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。
