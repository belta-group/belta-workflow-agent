# goal 連携の定期ジョブ雛形（scheduler 用）

goal スキルから [scheduler](../../scheduler/SKILL.md) へ委譲するときの本文雛形。
登録の作法（taskId の `belta-wf-` プレフィクス・`JOBS.md` 索引・`mcp__scheduled-tasks` 委譲）は
scheduler スキルと [job-templates.md](../../scheduler/references/job-templates.md) の鉄則に従う。

> **鉄則（再掲）**: 各ジョブは会話履歴ゼロの独立セッションで実行される。`<PLUGIN_ROOT>` は
> 登録時に実際の絶対パスへ置換し、`<...>` のプレースホルダはすべて実値に置換する。
> 共通前段（agent_home 解決・profile 読込）は job-templates.md のものをそのまま使う。

---

## 1. 週次ゴール棚卸し（belta-wf-goal-review）

推奨 cron 例: `10 9 * * 1`（毎週月曜 9:10）。停滞ゴールが静かに消えていくのを防ぐ。

```
（共通前段に続けて）
3. ゴールを走査する（読み取り専用・fail-open）:
   node "<PLUGIN_ROOT>/scripts/goal-scan.js"
4. 走査 JSON を材料に、ゴールの棚卸しを日本語でまとめる:
   - 進行中（active）の各ゴール: 進捗 done/total と次のステップを 1 行ずつ
   - 停滞（stale: true）のゴール: 「7 日以上更新がありません。続行/中断の判断が必要」と明示
   - blocked のステップ: 理由と、解消に必要そうなアクション
   - target_date が近い（7 日以内）ゴール: 期日と残ステップ数を強調
5. 結果を <HOME>/.belta/reports/<当日>-goal-review.md に Write で保存する。
6. （任意・profile に Slack 接続があり利用者が希望した場合のみ）要約を本人の Slack DM に送る。
   機密度が社外秘/極秘のゴール内容は要約から除くか抽象化する。
   ※ 独立セッションなので AskUserQuestion はせず、判断が要る項目はレポートに残すだけにする。
```

---

## 2. ゴール期日リマインド（belta-wf-goal-deadline-<slug>）

`target_date` 付きゴールの作成時に、利用者が希望した場合のみ登録する **単発寄り** のジョブ。
推奨 cron 例: 期日の 3 日前と当日の朝（例: 期日 2026-06-20 なら `0 9 17 6 *` と `0 9 20 6 *` の 2 本、
または毎日 9:00 で本文側に「期日 7 日前から通知」の条件を書く）。

```
（共通前段に続けて）
3. 対象ゴールの現状を取得する:
   node "<PLUGIN_ROOT>/scripts/goal-scan.js" --slug <slug>
4. found が false、または status が done / archived なら、何もせず終了する
   （このジョブ自体の削除を <HOME>/.belta/reports/<当日>-goal-deadline.md にメモして終わる）。
5. active なら、期日 <target_date> までの残り日数と残ステップ（pending / blocked）を
   <HOME>/.belta/reports/<当日>-goal-deadline.md に Write で保存する。
6. （任意・利用者が希望した場合のみ）本人の Slack DM に「ゴール『<ゴール文>』期日まで N 日、
   残り M ステップ」と短く知らせる。
```

> ゴールが完了・アーカイブされたら、このリマインドジョブは不要になる。goal スキルは
> Step 4（完了とアーカイブ）で、対応する `belta-wf-goal-deadline-<slug>` ジョブが
> 残っていないか scheduler の一覧で確認し、あれば削除を提案すること。
