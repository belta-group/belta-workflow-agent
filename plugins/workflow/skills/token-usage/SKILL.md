---
name: token-usage
description: >
  トークン消費の可視化と利用制限（レートリミット）対策の自己診断。どの処理（ツール・
  スキル・モデル）にどれだけトークンを使ったかを集計し、直近 5 時間のローリング消費
  ゲージ付きの HTML ダッシュボード（~/.belta/token-dashboard.html）を再生成する。
  「トークン使ってる？」「消費量を見たい」「利用制限にかかった/すぐ上限になる」
  「どの処理が重い」「コストを知りたい」等の発話、または /usage コマンドで起動する。
  レポート生成（/report）や過去の振り返り（/insights）とは別物（こちらは消費量の数値診断のみ）。
---

# トークン消費ダッシュボード（token-usage）

`hooks/token-usage.js`（Stop フック）が毎セッション記録するトークン消費（`~/.belta/audit/tokens/`）を材料に、消費の内訳と直近 5 時間のローリング消費を可視化する。Claude の利用制限（Pro/Max の 5 時間ごとの上限）に「一瞬で当たってしまう」事故の自己診断が目的。

- 集計・HTML 生成＝**決定的な Node スクリプト**（`scripts/token-dashboard.js`）が担う。
- 結果の意味づけ・省トークンの助言＝**このスキル（LLM）** が担う。観察データを根拠にし、創作しない。

この二層分担は `avatar` / `report` と同じ。

## いつ使うか（トリガ）

- `/usage` を実行したとき
- 「トークンどれくらい使ってる」「消費量・コストを見たい」「利用制限にかかった」「すぐ上限になる」「どの処理が重い」等の発話

## ワークフロー

### Step 1: 集計（決定的・読み取り専用）

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/token-dashboard.js" --md
```

- 直近 5 時間の消費（制限相当の推計）としきい値・累計・モデル別・重い処理上位を受け取る。fail-open（記録が無ければ「まだ記録がありません」）。

### Step 2: ダッシュボード再生成（決定的)

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/token-dashboard.js"
```

- `~/.belta/token-dashboard.html` を再生成し、`{ ok, out, url, markdown }` を返す。

### Step 3: 要約と助言（LLM）

1. **結論を先に**: 直近 5 時間の消費（しきい値に対する割合）と、重い処理・モデルの上位を 2〜3 行で。
2. 数値に応じた**省トークンの助言**を 1〜2 点だけ（多く並べない）。根拠は集計データ:
   - Opus 系の比率が高い → 「軽い作業は Sonnet 系に切り替えると制限に当たりにくい」
   - キャッシュヒット率が低い（目安 50% 未満） → 「セッションを細切れに開き直すよりまとめて作業するとキャッシュが効く」
   - 特定ツール（大量 Read / WebFetch / Task 等）が突出 → 「大きなファイルの全文読み込みや繰り返し調査を絞る」
   - 直近 5 時間がしきい値超過 → 「少し時間を置く（5 時間窓が回復する）か、重い処理を後回しに」
3. **【必須】締めは `markdown` の値（`[⚡ トークン消費ダッシュボードを開く](file://…)`）をそのまま 1 行で出力。** 生のパスを本文に書かない。`markdown` が空のときだけ `out` を文言で案内（fail-open）。

## 罠（Gotchas）

- **数値は公式の制限カウントではない**。このエージェントのセッション分だけの推計（他プロジェクト・claude.ai 分は見えない）。「制限まであと何トークン」とは**言い切らない**こと（目安として案内する）。
- 「制限相当」は cache 読取も満額で数える推計、「課金相当」は cache 読取 0.1 掛け。**両者は別物**なので混ぜて語らない。
- ツール別内訳は**ターン単位の均等按分による近似**。「Read に正確に X トークン」ではなく「Read を含む処理が重い傾向」と表現する。
- 内訳（モデル別・処理別・時系列）は新形式（schema_version 2）の記録にしか無い。導入直後は累計しか出ないことがある（フックが記録するのは各セッションの Stop 時）。
- 集計は `cat`/`grep` で直接走査せず、必ずスクリプトに委ねる（Mac / Windows 両対応・按分ロジックの一貫性）。
- 読み取り専用。記録（`audit/tokens/`）を書き換えない。生成物は `token-dashboard.html` のみ。

## 設定

- 警告しきい値: `~/.belta/config.yaml` の `token_5h_warn`（既定 70000。Max 5x プランの 5 時間枠の目安の約 8 割。0 で警告オフ）。利用者が「警告がうるさい/もっと早く知りたい」と言ったら `node "${CLAUDE_PLUGIN_ROOT}/scripts/belta-init.js" set token_5h_warn <値>` で調整を提案する。プランが分からなければ AskUserQuestion で確認してよい（Pro ≈ 44k / Max 5x ≈ 88k / Max 20x ≈ 220k が 5 時間枠の世間的な目安）。

## ファイル参照

- 集計・描画エンジン: [scripts/token-dashboard.js](../../scripts/token-dashboard.js)
- 記録フック（Stop）: [hooks/token-usage.js](../../hooks/token-usage.js)
- 5 時間合算・しきい値の共有ロジック: [hooks/tokens-util.js](../../hooks/tokens-util.js)
- 警告の注入元: [hooks/session-start.js](../../hooks/session-start.js)（セッション開始時）/ [hooks/repeat-detect.js](../../hooks/repeat-detect.js)（セッション中・5 時間に 1 回）
