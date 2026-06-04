# 定期ジョブ本文テンプレート集

`scheduler` スキルが `mcp__scheduled-tasks__create_scheduled_task` の `prompt` に焼き込む雛形。

> **鉄則**: 各ジョブは **会話履歴ゼロの独立セッション** で実行される。本文はこのセッションの文脈を一切前提にできない。下の雛形の `<PLUGIN_ROOT>` は **登録時に実際の絶対パスへ置換** すること（`${CLAUDE_PLUGIN_ROOT}` は独立セッションで展開されない可能性があるため焼き込む）。`<...>` のプレースホルダはすべて実値に置換する。

共通の前段（すべてのジョブ本文の冒頭に置く）:

```
あなたは Belta ワークフローエージェントの定期ジョブです。この実行には会話履歴がありません。
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

## 登録後の索引記録

どのテンプレを使っても、登録後に `<HOME>/.belta/scheduler/JOBS.md` へ 1 行追記する:

```
- belta-wf-weekly-notes — 週次 notes 振り返り [cron:3 9 * * 1 / registered:YYYY-MM-DD / engine:mcp / plugin_root:<絶対パス>]
```

`plugin_root` を記録しておくと、プラグイン更新でパスが変わったときに再登録の必要を検知できる。
