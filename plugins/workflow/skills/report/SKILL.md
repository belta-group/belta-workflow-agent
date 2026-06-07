---
name: report
description: >
  デイリー / ウィークリー / マンスリーの「自己成長レポート」を作る。蓄積した notes
  （~/.belta/notes/）と育成アバターの成長指標（avatar-stats）を材料に、(1) その期間に
  何をしていたか、(2) 成長した点、(3) 次に取るべきアクション、(4) 何を学ぶとよいかの
  アドバイスをまとめる。「日報」「週報」「月報」「今日/今週/今月どうだった」「成長レポート」
  「次に何をすべき」「何を勉強すれば」等の発話、または /report コマンドで起動する。
  過去の振り返り（/insights）と違い、前向きな次アクション・学習提案が主役。
---

# 自己成長レポート（report）

`~/.belta/notes/`（その日の依頼ログ）と育成アバターの成長指標（`avatar-stats.js`）を材料に、期間レポートを作る。`/insights`（過去の振り返り）と役割を分け、**前向きの「次アクション」「学ぶとよいこと」までを含む**のが本スキルの主眼。

- 走査・集計（材料抽出）＝**決定的な Node スクリプト**（`notes-scan.js`・`avatar-stats.js`）が担う。
- 要約・成長の意味づけ・アドバイス＝**このスキル（LLM）** が担う。観察データを根拠にし、創作しない。

この二層分担は `insights` / `user-model` と同じ。

## いつ使うか（トリガ）

- `/report [daily|weekly|monthly]`（略 `d|w|m`、省略時は `daily`）を実行したとき
- 「日報／週報／月報」「今日（今週・今月）どうだった」「成長レポート」「振り返って次どうする」「次に何をすべき」「何を勉強したらいい」等の発話

> `/insights` との違い：insights は「過去に何をしたか」の振り返りが主。report は同じ材料に加えて **成長の度合い**と**前向きの提案（次アクション・学習）**を必ず含む。利用者が単に「最近何してた」だけを求めたら insights、「成長」「次どうする」「勉強」を含むなら report。

## 期間の決定

| 引数 | 期間 | notes 走査日数 |
| --- | --- | --- |
| `daily` / `d` / （省略） | 当日中心 | `--days 1` |
| `weekly` / `w` | 直近1週間 | `--days 7` |
| `monthly` / `m` | 直近1ヶ月 | `--days 30` |

## ワークフロー

### Step 1: 材料の決定的収集（読み取り専用）

1. 期間から走査日数 `N`（1 / 7 / 30）を決める。
2. 活動データ：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/notes-scan.js" --days <N>
   ```

   - `top_requests`（正規化キーの頻度・サンプル）・`sessions`（時系列）・`topic_notes`（蓄積知識の地図）を受け取る。fail-open（notes が無ければ `session_count: 0`）。
3. 成長指標：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/avatar-stats.js" --json
   ```

   - `level` / `xp` / `streak` / `badges`（earned・locked）/ `usage`（top_skills・top_commands・agent_usage 等）/ `raw`（rules・agents・skills_authored・memory・corrections・tools・active_days）を受け取る。
4. 文脈補助（**あれば**読む。無ければ飛ばす）：
   - `~/.belta/reports/` 内の **前回の同種レポート**（`*-<period>-report.md`）→ 増分・変化の比較に使う。
   - `~/.belta/user-model.md`（観察された傾向）/ `~/.belta/rules/RULES.md`（明示ルール）/ `~/.belta/memory/MEMORY.md`（事実訂正）。
   - `~/.belta/todos/`・`~/.belta/inbox/`（未処理＝次アクションの種）。

> パスはホーム環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決される。`cat`/`grep` で notes を直接走査せず、スクリプトに委ねる（クロスプラットフォーム・正規化の一貫性）。

### Step 2: レポート合成（LLM・4セクション）

[references/report-templates.md](references/report-templates.md) の期間別テンプレと**アドバイス根拠ヒューリスティクス**に従い、結論先出し・日常語で 4 セクションにまとめる：

1. **① やったこと** — `top_requests`/`sessions` から、その期間の主な活動を 3〜5 点。完全一致でなく意図でまとめる。
2. **② 成長した点** — avatar-stats から、Lv/XP の伸び・新しく獲得したバッジ・連続稼働・ルール/エージェント/スキル/記憶の増加。**前回レポートがあれば増分**で語る（無ければ「現時点の到達点」）。
3. **③ 次のアクション** — 反復している依頼で未自動化のもの、`todos`/`inbox` の未処理、やりかけ、から **具体的な次の一手**を 2〜4 点。
4. **④ 学ぶとよいこと** — 観察データ起点の学習提案（例：ツール利用が偏っている→他ツールや自動化を学ぶ／訂正が多い領域→その知識を補う／locked バッジ→次に狙う習慣）。**必ず根拠（どの観察からそう言えるか）を添える。**

データが乏しい（`session_count` が 0〜1、avatar が Lv 低位）ときは創作せず、「まだレポートにする材料が少ないです。もう少し使うと充実します」と正直に返す。

### Step 3: 保存と案内

1. レポート本文を `~/.belta/reports/YYYY-MM-DD-<period>-report.md` に Write で保存（`period` は `daily`/`weekly`/`monthly`）。
2. 会話には**結論を先に**短く要約し、保存先は**クリック可能な Markdown リンク**で案内する（生のパスを本文に書かない）：
   - リンクは `node` で組める：`node -e "console.log(require('url').pathToFileURL(process.argv[1]).href)" "<保存した絶対パス>"` の出力を使い、`[📄 レポートを開く](<その file:// URL>)` の形で 1 行出す。

> `reports/` は `notes/` の**配下に置かない**（`notes-record.js` の retention が日次ログを誤削除しないため）。`~/.belta/` 全体が `.gitignore` 対象でリポジトリには出ない。

## 重要な注意事項

- **マンスリーの正直な制約**：notes は保持期間（既定14日・`config.yaml` の `notes_retention_days`）で剪定されるため、30日分の生の依頼履歴は揃わない。月報は **avatar-stats の累計成長（`history.json` 由来で剪定耐性）＋ `reports/` の過去レポート＋残存 notes** に基づき、活動詳細については「詳細な依頼履歴は直近約14日分です」と明記する（创作で埋めない）。週報を継続して残しておくと月報の材料が増える。
- 走査・集計は必ずスクリプトに委ねる（`cat`/`grep`/`sed` を必須経路に置かない。Mac / Windows 両対応）。
- 読み取り専用。notes・avatar データを書き換えない。生成物は `reports/` のみ。
- アドバイス（③④）は**観察データを根拠にする**。投資・財務など専門助言には踏み込まない（業務スキルの成長提案に留める）。
- 機密度（`profile.md`）を尊重し、レポートを外部（Slack 等）へ送るのは運営モードの確認フローに従う（既定はローカル保存のみ）。
- 強い反復傾向を見つけたら、末尾で [user-model](../user-model/SKILL.md)（暗黙傾向）や [rule-learning](../rule-learning/SKILL.md)（明示ルール）、[agent-learning](../agent-learning/SKILL.md)（専用エージェント化）への橋渡しを `AskUserQuestion` で提案してよい（侵襲度の低い順）。

## ファイル参照

- 期間別テンプレ＋アドバイス根拠: [references/report-templates.md](references/report-templates.md)
- 活動走査エンジン: [scripts/notes-scan.js](../../scripts/notes-scan.js)
- 成長指標: [scripts/avatar-stats.js](../../scripts/avatar-stats.js)
- 正規化・notes パーサ（走査が再利用）: [hooks/repeat-util.js](../../hooks/repeat-util.js)
- 過去の振り返り（役割分担）: [insights](../insights/SKILL.md)
- 暗黙傾向／明示ルール／専用エージェント化への橋渡し: [user-model](../user-model/SKILL.md) / [rule-learning](../rule-learning/SKILL.md) / [agent-learning](../agent-learning/SKILL.md)
- 定期自動実行（後日登録）: [scheduler](../scheduler/SKILL.md)
