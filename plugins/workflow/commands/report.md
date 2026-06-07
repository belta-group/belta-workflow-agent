---
description: デイリー/ウィークリー/マンスリーの自己成長レポートを作る。期間中に何をしたか・成長した点・次に取るべきアクション・何を勉強するとよいかを、notes とアバター成長指標からまとめる。日報/週報/月報。
argument-hint: "[daily|weekly|monthly]（略 d|w|m・省略時 daily）"
model: inherit
---

<!--
model: inherit — 活動の意味づけ・成長の翻訳・前向きなアドバイス（次アクション/学習）を
行うため、セッションのモデル（通常 Opus）を継承して品質を落とさない。
走査・集計（材料抽出）は notes-scan.js / avatar-stats.js が決定的に担い、
要約とアドバイスは LLM が行う二層構造。
-->

# /report — 自己成長レポート（日報 / 週報 / 月報）

`report` スキル（`skills/report/SKILL.md`）を起動する入口コマンド。`~/.belta/notes/`（依頼ログ）と育成アバターの成長指標（`avatar-stats.js`）を材料に、期間レポートを作る。

引数（任意）:

- `daily` / `d` / （省略） — 当日中心（notes `--days 1`）。
- `weekly` / `w` — 直近1週間（notes `--days 7`）。
- `monthly` / `m` — 直近1ヶ月（notes `--days 30`）。

手順はすべて `skills/report/SKILL.md` に従う。**利用者に見せるレポート・確認の文面はすべて日本語で出力する**（走査スクリプトのフィールド名が英語でも、まとめは日本語に翻訳する）。要点:

1. 期間→走査日数 `N`（1/7/30）を決め、`node "${CLAUDE_PLUGIN_ROOT}/scripts/notes-scan.js" --days <N>`（活動）と `node "${CLAUDE_PLUGIN_ROOT}/scripts/avatar-stats.js" --json`（成長）を Bash で実行（読み取り専用・fail-open）。
2. 4 セクションでまとめる（[references/report-templates.md] のテンプレ＋根拠ヒューリスティクスに従う）：**① やったこと / ② 成長した点 / ③ 次のアクション / ④ 学ぶとよいこと**。アドバイスは観察データを根拠にし、創作しない。
3. `~/.belta/reports/YYYY-MM-DD-<period>-report.md` に Write で保存し、会話には結論先出しの要約＋保存先を**クリック可能な Markdown リンク**で案内（生パスを書かない）。
4. マンスリーは notes 保持期間（既定14日）の都合で生の依頼履歴が30日揃わないため、活動詳細は「直近約14日分」と明記し、成長は累計指標（`history.json`）と過去レポートで補う。

> 走査対象 `~/.belta/notes/`・保存先 `~/.belta/reports/` は「あなたのパソコン内の個人フォルダ」。リポジトリには出ない。パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。`/insights` が「過去の振り返り」中心なのに対し、`/report` は**成長＋次アクション＋学習提案**まで含むのが違い。
