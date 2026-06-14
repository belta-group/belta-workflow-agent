# 定期ジョブ本文テンプレート集

`scheduler` スキルが `mcp__scheduled-tasks__create_scheduled_task` の `prompt` に焼き込む雛形。

> **鉄則**: 各ジョブは **会話履歴ゼロの独立セッション** で実行される。本文はこのセッションの文脈を一切前提にできない。下の雛形の `<PLUGIN_ROOT>` は **登録時に実際の絶対パスへ置換** すること（`${CLAUDE_PLUGIN_ROOT}` は独立セッションで展開されない可能性があるため焼き込む）。`<...>` のプレースホルダはすべて実値に置換する。

共通の前段（すべてのジョブ本文の冒頭に置く）:

```
あなたは BELTA ワークフローエージェントの定期ジョブです。この実行には会話履歴がありません。
以下を順に行ってください。途中で失敗しても致命的に扱わず、できた範囲で結果を残してください。

1. 専用フォルダ（agent_home）を解決する:
   node "<PLUGIN_ROOT>/scripts/belta-init.js" get agent_home
   （値が空なら現在のカレントを agent_home とみなす）
2. 利用者プロフィールを読む: <HOME>/.belta/profile.md（機密度を尊重する）
   ※ <HOME> は POSIX では $HOME、Windows では %USERPROFILE%。
```

---

## 1. 毎朝 TODO 要約（belta-wf-morning-todo）

推奨 cron 例: `0 8 * * 1-5`（平日 8:00）

```
（共通前段に続けて）
3. 当日の TODO と直近の依頼を読む:
   - <HOME>/.belta/todos/ の当日ファイル（YYYY-MM-DD.md。無ければ直近）
   - node "<PLUGIN_ROOT>/scripts/notes-scan.js" --days 2
4. 「今日やるべきこと」を優先度付きで 5 件以内に要約する。やりかけ・締切が近いものを上に。
5. 結果を <HOME>/.belta/reports/<当日>-morning-todo.md に Write で保存する。
6. （任意・profile に Slack 接続があり利用者が希望した場合のみ）要約を本人の Slack DM に送る。
   機密度が社外秘/極秘の項目は要約から除くか抽象化する。
```

---

## 2. 週次 notes 振り返り = insights 定期実行（belta-wf-weekly-notes）

推奨 cron 例: `3 9 * * 1`（毎週月曜 9:03）

```
（共通前段に続けて）
3. 直近 7 日の notes を走査する:
   node "<PLUGIN_ROOT>/scripts/notes-scan.js" --days 7
4. 走査 JSON の top_requests / sessions / topic_notes を材料に、先週の振り返りをまとめる:
   - 結論（1〜2 文）: 先週は主に何をしていたか
   - 繰り返しているテーマ（頻度順 3〜5 件）
   - 抜け漏れ・やりかけ（推測は「かもしれません」と明示）
5. 結果を <HOME>/.belta/reports/<当日>-weekly-notes.md に Write で保存する。
6. 明確に反復しているテーマ（同一キー複数回・意図が同じ依頼 3 回以上）があれば、
   レポート末尾に「user-model.md への反映候補」として箇条書きで残す
   （独立セッションなので AskUserQuestion はせず、候補メモに留める）。
```

> これは `insights` スキルの手順を独立セッション向けに直書きしたもの（スキルを「呼ぶ」のでなく手順を埋め込む）。

---

## 3. 週次 user-model 深化（belta-wf-user-model）

推奨 cron 例: `15 9 * * 1`（毎週月曜 9:15）

```
（共通前段に続けて）
3. user-model モードで notes を走査する（広めの窓）:
   node "<PLUGIN_ROOT>/scripts/notes-scan.js" --mode user-model
4. 走査材料から、利用者の暗黙傾向を確信度付きで言語化する:
   常用ツール / 繰り返す業務 / 段取りの好み / 言い回し / 作業の時間帯。
   - 出現 1〜2 回は「候補（未確定）」、3 回以上を「傾向」とする。
   - 推測を断定しない。出典 notes の日付を添える。
5. <HOME>/.belta/user-model.md を Read（無ければ新規）→ 既存項目と統合して Write する。
   - profile.md は絶対に上書きしない。
   - 確信度「低」は「## 候補（未確定）」セクションへ。矛盾は「## 変更履歴」に残す。
   - PII（個人特定情報）は書かない。傾向の抽象度に留める。
   - 構成は <PLUGIN_ROOT>/skills/user-model/references/user-model-template.md に従う。
6. 更新点の要約を <HOME>/.belta/reports/<当日>-user-model.md に残す。
```

> これは `user-model` スキルの手順を独立セッション向けに直書きしたもの。

---

## 4. 週次 inbox 監査（belta-wf-inbox-audit）

推奨 cron 例: `0 17 * * 5`（毎週金曜 17:00）

```
（共通前段に続けて）
3. <HOME>/.belta/inbox/ の直近 7 日分のファイルを読む。
4. 未処理・放置されていそうな項目を洗い出し、対応要否を仕分けて要約する。
5. 結果を <HOME>/.belta/reports/<当日>-inbox-audit.md に Write で保存する。
```

---

## 5. 日次アバター更新（belta-wf-daily-avatar）

推奨 cron 例: `30 8 * * *`（毎日 8:30）。「1 日 1 回、業務後にアバターを育てる」用途。

```
（共通前段に続けて）
3. アバターを集計してダッシュボードを再生成する（いずれも決定的・LLM 消費なし・fail-open）:
   node "<PLUGIN_ROOT>/scripts/avatar-stats.js" --md
   node "<PLUGIN_ROOT>/scripts/avatar-render.js"
4. 生成された <HOME>/.belta/dashboard.html のパスと、Lv・獲得バッジ・連続稼働を 3 行で控える。
5. （任意・利用者が希望した場合のみ）レベルアップや新バッジ獲得があれば本人の Slack DM に短く知らせる。
   ※ このジョブは GitHub 公開（--publish）を行わない。公開はローカルではなく利用者の明示操作に限る。
```

> 集計・描画は決定的 Node が担うため、このジョブはトークンをほぼ消費しない（通知文を書く分だけ）。

---

## 6. 週次 成長日記（belta-wf-weekly-growth）

推奨 cron 例: `20 9 * * 1`（毎週月曜 9:20）。アバターの 1 週間の成長を物語にする（`insights` の成長日記に相当）。

```
（共通前段に続けて）
3. アバターの現在値と直近 notes を集計する:
   node "<PLUGIN_ROOT>/scripts/avatar-stats.js" --json
   node "<PLUGIN_ROOT>/scripts/notes-scan.js" --days 7
4. 先週からの成長を「育成日記」として日常語でまとめる:
   - 今の Lv と段階、先週比で増えたもの（ルール / エージェント / スキル / 連続稼働）
   - 新しく獲得したバッジ、次に狙えるバッジ（locked の req を 1〜2 個）
   - 励ましのひとこと（事実に基づく。創作しない）
5. 結果を <HOME>/.belta/reports/<当日>-growth-diary.md に Write で保存する。
```

> これは `avatar` + `insights` の手順を独立セッション向けに直書きしたもの。数値は Node、物語は LLM。

---

## 7. 自己成長レポート（belta-wf-daily-report / -weekly-report / -monthly-report）

`/report` 相当を定期実行する。手動コマンドの定期版（`report` スキルの手順を独立セッション向けに直書き）。3 周期それぞれ別ジョブとして登録する（必要なものだけでよい）。

推奨 cron 例:
- デイリー `belta-wf-daily-report`: `5 8 * * 1-5`（平日 8:05）
- ウィークリー `belta-wf-weekly-report`: `30 9 * * 1`（毎週月曜 9:30）
- マンスリー `belta-wf-monthly-report`: `0 9 1 * *`（毎月 1 日 9:00）

```
（共通前段に続けて）
3. 周期に応じた走査日数 N を決める（daily=1 / weekly=7 / monthly=30）。活動と成長を集計する:
   node "<PLUGIN_ROOT>/scripts/notes-scan.js" --days <N>
   node "<PLUGIN_ROOT>/scripts/avatar-stats.js" --json
   （任意で <HOME>/.belta/reports/ の前回同種レポート・todos/・inbox/ も読む）
4. 4 セクションでまとめる（<PLUGIN_ROOT>/skills/report/references/report-templates.md に従う）:
   ① やったこと ② 成長した点 ③ 次のアクション ④ 学ぶとよいこと。
   - アドバイスは観察データを根拠にし、創作しない。
   - マンスリーは notes 保持期間（既定14日）の都合で生履歴が30日揃わない旨を明記し、
     成長は累計指標（avatar の history.json）と過去レポートで補う。
5. 結果を <HOME>/.belta/reports/<当日>-<period>-report.md に Write で保存する（period=daily/weekly/monthly）。
6. （任意・利用者が希望した場合のみ）要点を本人の Slack DM に短く知らせる。
   機密度が社外秘/極秘の項目は要約から除くか抽象化する。独立セッションなので AskUserQuestion はしない。
```

> 数値・走査は Node（決定的）、要約とアドバイスは LLM。`/report` の手動実行と同じ生成物（`reports/<当日>-<period>-report.md`）になる。

---

## 登録後の索引記録

どのテンプレを使っても、登録後に `<HOME>/.belta/scheduler/JOBS.md` へ 1 行追記する:

```
- belta-wf-weekly-notes — 週次 notes 振り返り [cron:3 9 * * 1 / registered:YYYY-MM-DD / engine:mcp / plugin_root:<絶対パス>]
```

`plugin_root` を記録しておくと、プラグイン更新でパスが変わったときに再登録の必要を検知できる。
