---
description: 育成アバターのダッシュボードを更新して表示する。使い込むほど貯まる活動データ（セッション・ルール・エージェント・スキル等）からレベル・ステータス・バッジを再計算し、ローカル HTML を再生成する。名前・画像の設定や、希望時の GitHub Pages 公開も。
argument-hint: "[--publish] [--days N] | setup"
model: inherit
---

<!--
model: inherit — 数値の集計・HTML 生成は決定的 Node スクリプトが担う（LLM 不要）。
コマンドは「スクリプト実行 → 結果の要約 → 任意で公開確認」の薄い入口なので継承で十分。
-->

# /avatar — 育成アバター ダッシュボード

`avatar` スキル（`skills/avatar/SKILL.md`）を起動する入口コマンド。`~/.belta/` に貯まった活動データから、相棒アバターのレベル・6軸ステータス・実績バッジ・連続稼働ストリーク・スキルツリーを再計算し、自己完結の HTML ダッシュボード（`~/.belta/dashboard.html`）を再生成する。

引数（任意）:

- 引数なし — 集計 → ダッシュボード再生成 → 会話に成長サマリを表示。
- `setup` — アバターの名前・ポートレート画像を設定/変更する（`avatar-setup.js`）。
- `--publish` — 匿名化した数値サマリだけを GitHub Pages 公開用に書き出す（**機密ゲートを必ず通す**）。
- `--days N` — （成長日記を併せて出す場合の）振り返り日数。

手順はすべて `skills/avatar/SKILL.md` に従う。要点:

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/avatar-stats.js" --md` で集計（決定的・fail-open・LLM 消費なし）。
2. `node "${CLAUDE_PLUGIN_ROOT}/scripts/avatar-render.js"` で `~/.belta/dashboard.html` を再生成。
3. レベル・直近の成長・獲得バッジを会話に要約し、`avatar-render.js` 出力の `url`（`file://` リンク）を使って**クリック可能な Markdown リンク**で案内する（例: `[ダッシュボードを開く](<url>)`）。毎回パスを手入力／コピペさせない。OS の open コマンドは打たない。`url` が空のときのみ `out` のパスを文言で案内（fail-open）。
4. `setup` 指定時のみ `avatar-setup.js` を呼び、名前（と任意の画像パス）を保存。
5. `--publish` 指定時のみ、匿名化 → 目視確認 → `AskUserQuestion` → コミット/プッシュ（`ask` 権限）。

> ダッシュボード `~/.belta/dashboard.html` は「あなたのパソコン内の個人フォルダ」に生成され、外部送信されない。パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。
