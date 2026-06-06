# 成長日記（育成アバター連携）の書き方

`insights` が育成アバターの成長を「日記」として綴るときの手順。数値の算出は決定的な Node（[avatar](../../avatar/SKILL.md) の `avatar-stats.js`）、物語化だけ LLM が担う（二層分担）。

## 材料の取得

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/avatar-stats.js" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/notes-scan.js" --days 7
```

- `avatar-stats.js --json` … 現在の Lv / XP / 6軸 / バッジ（earned・locked）/ ストリーク / スキルツリー / raw カウント。
- `notes-scan.js --days 7` … 先週の動き（テーマ・時系列）。

## 先週比の出し方（任意）

`~/.belta/reports/` に前回の成長日記（`*-growth-diary.md`）があれば、その中の Lv やカウントと比較して「増分」を述べる。無ければ「今週の到達点」として書く（創作しない）。

## 日記の構成（結論先出し・励ます）

1. **見出し**: 「🎮 今週の成長日記（YYYY-MM-DD）」
2. **結論（1〜2 文）**: 「Lv.X『段階名』になりました。今週は主に○○で伸びました」
3. **伸びた点**: ルール / 採用エージェント / 自作スキル / 連続稼働のうち増えたもの。
4. **新しい称号**: 今週 earned に加わったバッジ（emoji + 名前）。
5. **次の目標**: locked のうち達成が近いものを 1〜2 個（その `req` を提示）。
6. **ひとこと**: 事実に基づく短い励まし。

## 注意

- 数値を創作しない。データが乏しい（Lv.1・バッジ無し）ときは「まだ育ち始めです。使うほど育ちます」と正直に書く。
- 依頼内容の機密度（`profile.md`）を尊重。外部送信（Slack 等）する場合は運営モードの確認に従う。
- 保存先は `~/.belta/reports/`（`notes/` の配下に置かない＝retention で消されないため）。
