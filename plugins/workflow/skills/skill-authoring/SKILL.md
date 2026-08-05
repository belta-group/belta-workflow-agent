---
name: skill-authoring
description: >
  繰り返し現れる専門業務を、利用者専用の新しいスキルとして自作（authoring）する。
  既存スキルの導入（skill-suggestion）ではなく、手元に無い手順・専門知識を SKILL.md
  として新規生成し、専用フォルダ（~/my-agent）の `.claude/skills/<name>/` に直接置く。
  rule / agent / 既存スキル導入のどれでも賄えない専門業務が 3 回以上反復したとき、
  workflow スキルから委譲され、スキル化を提案する。「これスキルにして」「いつもの手順を
  道具にして」等の明示依頼でも起動する。
---

# 自動スキル化（skill-authoring）

パーソナライズ 4 機能の最後の砦。利用者の **専門性のある繰り返し業務** を、その業務専用の **新しいスキル** として自作する。`skill-suggestion` が「世にある既製品を探して導入する」のに対し、本スキルは「**手元の業務に合わせた専用の道具を新しくあつらえる**」点で役割が分かれる。

本プラグインは専用フォルダ（`~/my-agent`）限定（ローカルスコープ）で動くため、自作スキルも **そのフォルダの `.claude/skills/` に直接置く** だけで、そのフォルダ内のセッションで自動的に発火対象になる。`~/.claude/`（グローバル）へのディレクトリ symlink/コピー公開は **行わない**（ローカル限定方針と整合し、symlink 機構の保守も不要になる）。

- 実体: `<agent_home>/.claude/skills/<name>/`（`SKILL.md` + 必要なら `references/` `scripts/`。`<agent_home>` は専用フォルダの絶対パス）
- 索引: `~/.belta/skills/AUTHORED.md`（発火・採用の追跡用。実体とは分離してホーム側に残す。既製スキルの `SKILLS.md` と同居）

> **`<agent_home>` の解決**: `node "${CLAUDE_PLUGIN_ROOT}/scripts/belta-init.js" get agent_home` で専用フォルダの絶対パスを得る。空（未設定）なら、いま開いている専用フォルダ＝プロジェクトルートに相対の `.claude/skills/` を使ってよい。

> 生成 SKILL.md の中身（記述・description 設計）は Claude Code 標準の `skill-creator` スキルに委譲してよい。本スキルは「**いつ自作すべきか（消去法ゲート）**」「**どこに置くか**」「**索引と継続追跡**」を司る。

## 位置づけ：これは「最終手段」

スキルは 4 機能の中で最も **侵襲的** である。`description` 一致で **自動発火** し、内容が **主コンテキストに読み込まれ**、実行スクリプトを同梱しうる。スコープがズレたスキルは不要な場面で発火し、毎回トークンを食う。したがって自作スキルは、**他の 3 手段で賄えなかったときの最後の選択肢** とする。

| 先に検討する手段 | 賄える範囲 | 委譲先 |
| --- | --- | --- |
| テキスト指示で一般化できる好み・訂正 | 言い回し・段取りのルール | [rule-learning](../rule-learning/SKILL.md) |
| 領域まるごとを隔離コンテキストへ委譲 | 専用 subagent（明示呼び出し） | [agent-learning](../agent-learning/SKILL.md) |
| 既にある配布済みスキルで足りる | 既製スキルの探索・導入 | [skill-suggestion](../skill-suggestion/SKILL.md) |

---

## いつ使うか（消去法ゲート）

次の **4 条件をすべて満たす** ときだけ、自作スキル化を候補にする。回数は補助条件で、本質は「**他の 3 手段で埋まらないこと**」の消去法である。

> **判定材料の前提**: 反復検知は `~/.belta/notes/` の日次ログが土台。`Stop` フック（`hooks/notes-record.js`）が「その日の利用者依頼」を 1 セッション 1 行で確定記録しているため、LLM の自動記録が漏れても最低限の履歴が残る。走査前にまず当日・直近の notes を Read すること。

1. **反復（3 回以上）** — 同種の **専門業務** が 3 回以上現れている。**別セッションをまたぐ反復だけでなく、同一セッション内で同じ専門業務を 3 回以上繰り返した場合も含める**（同じ作業を反復させているとみなす。ただし 1 つの依頼を達成する過程での言い直し・継続は 1 回と数える）。agent-learning（2 回）より高い閾値にするのは、スキルが最も侵襲的だから。完全一致でなく **意図が同じ業務** で数える。一度きりは対象外。
2. **rule-learning で表現しきれない** — 手順が複数ステップにわたる／専門知識を伴うなどで、テキストのルール 1〜数行には収まらない。
3. **agent-learning でなくスキルが適切** — 隔離コンテキストへの「委譲」ではなく、**主作業の流れに自動で差し込みたい知識・手順**である（例: 特定フォーマットの帳票生成、専門ドメインの定型変換）。委譲して結果だけ受け取れば足りるなら agent-learning を選ぶ。
4. **既存スキルで賄えない** — `skill-suggestion` の手順（手元のスキル一覧の確認 + `find-skills` 探索）で適合する既製スキルが見つからない。見つかるなら導入（skill-suggestion）に回す。

> いずれか 1 つでも欠けたら自作しない。欠けた条件に対応する手段（rule / agent / skill-suggestion）へ素直に回す。

### 明示依頼での起動

利用者が「これスキルにして」「いつもの手順を道具にしておいて」等と **明示的に依頼** した場合は、条件 1（回数）を緩めてよい。ただし条件 2〜4（ルール・エージェント・既存スキルで足りないか）は必ず確認し、より軽い手段で足りるならそれを提案する。

---

## 自動化フロー

### Step 1: 消去法ゲートの確認 → スキル化を提案

1. 上の 4 条件を順に確認する。途中で外れたら、その条件に対応する手段を案内して終了する。
2. スキルの `name` を kebab-case で決める（例: `monthly-sales-report`, `contract-clause-extract`）。既存の自作スキル・既製スキルと衝突しないこと。
3. 利用者に **AskUserQuestion**（スキル化する / 今回は不要、+ 自由記述）で確認する。**何を自動化し、どんな場面で発火するか** を 1〜2 文で添える：

> 「最近『○○』の作業が 3 回続いていて、ルールにもエージェントにも既存スキルにも収まりません。`<name>` という専用スキルにしておくと、次回から○○の場面で自動的にこの手順で対応できます。作成しますか？」

### Step 2-a: 承認 → 生成 + 記録

1. [references/skill-template.md](references/skill-template.md) の構成に沿って `<agent_home>/.claude/skills/<name>/SKILL.md` を **Write ツールで生成** する（`<agent_home>` は上記の方法で解決。専用フォルダ内なら相対 `.claude/skills/<name>/SKILL.md` でもよい）。中身の質は `skill-creator` スキルに委譲してよい。
   - **`description` は狭く具体的に。** 自動発火の精度はここで決まる。広すぎる description は誤発火の元（位置づけ参照）。発火条件を限定し、業務ドメインの語を入れる。
   - 必要に応じて `references/`（参照知識）・`scripts/`（補助スクリプト）を同梱する。**スクリプトを置く場合は必ず Node.js 単一実装にし、`mkdir -p` / `cp` / `ln -s` 等の OS 依存コマンドを必須経路に置かない**（プラグインのクロスプラットフォーム実装規約 `cross-platform.md` に準拠）。
   - `source_notes` に検知元の `notes/YYYY-MM-DD.md`（3 件以上）を記録する。
   - symlink/コピーは不要。専用フォルダの `.claude/skills/` に置けば、そのフォルダのセッションで自動的に発火対象になる。
2. **自己監査（必須）**: 生成物を静的スキャナに通し、自分の作ったものを自分で検査する（読み取り専用・fail-open）：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/skill-audit.js" --name <name>
   ```

   `high` が出たら**索引に記録する前に直す**（典型: 生成した `scripts/` に OS 依存コマンドや `eval` を書いてしまった / frontmatter の `description` を書き忘れた）。`medium`（OS 依存コマンド・シェルスクリプト同梱・description が短い）も `cross-platform.md` / `skill-writing.md` 違反のサインなので直す。結果は `~/.belta/audit/skills/<name>.json` に残り、スキル許可ゲート（`hooks/skill-gate.js`）の判断材料にもなる。
3. 索引 `~/.belta/skills/AUTHORED.md` に **fired / adopted** を記録する（後述）。**この記録がスキル許可ゲートの allowset になる**ので、記録を飛ばすと次回起動時に確認ダイアログが出る。
4. **有効化確認**: 利用可能スキル一覧（または `/plugin`）に `<name>` が現れることを確認する。専用フォルダで開き直さないと現れない場合はその旨を案内する。
5. 「`<name>` を作成しました。次回からこの専用フォルダで○○の場面でこのスキルが働きます」と返す。

### Step 2-b: 拒否 → rejected 記録 + 冷却

`AUTHORED.md` に `rejected` を記録する。**同一業務を 3 回連続で却下されたら 14 営業日の冷却**（提案停止）に入れる。冷却期間と回数は当該行に残す。

---

## 採用後の継続追跡（起動時の実体存在確認）

運営モード起動時、`AUTHORED.md` に adopted 記録がある各スキルについて、実体ディレクトリが残っているかを確認する：

- `<agent_home>/.claude/skills/<name>/SKILL.md` が存在するかを Read（または `belta-init.js get agent_home` で解決したパス配下の一覧）で確認する。
- 実体が **消えている**（利用者が削除した）場合は、`AUTHORED.md` の該当行に `deleted_at:<YYYY-MM-DD>` を記録する（採用 → 削除の継続率メトリクス）。一度記録した deleted は再通知しない。
- 実体は在るが **`SKILL.md` の frontmatter が壊れている**（`name`/`description` 欠落で発火しない）場合は利用者に知らせ、再生成 or 行削除を確認する。

---

## AUTHORED.md の管理（常に LLM 文脈に読込）

`~/.belta/skills/AUTHORED.md` は起動時に毎回 Read されるインデックス。**`skill-suggestion` の `SKILLS.md`（既製スキルの導入記録）とは別ファイル** で、自作スキルの発火・採用・削除・却下を 1 行で追跡する。両者は `~/.belta/skills/` 直下に同居するが役割が異なる。

### 初期化（無ければ作成）

初めて自作スキルを扱うとき、次の内容で新規作成してから追記する：

```markdown
# AUTHORED — 自作スキル索引

このファイルは `skill-authoring` が自動生成・追記する。起動時に毎回読み込まれ、
発火 / 採用 / 削除 / 却下を追跡する。各スキル本文（`<name>/SKILL.md`）は発火時のみ読まれる。
既製スキルの導入記録は別ファイル `SKILLS.md`（skill-suggestion 管理）にある。

<!-- 追記形式: - [<name>](<name>/SKILL.md) — <description> [fired:YYYY-MM-DD / adopted:YYYY-MM-DD / deleted:- ] -->
```

### 追記 1 行の形式

```
- [monthly-sales-report](monthly-sales-report/SKILL.md) — 月次売上レポートの定型生成 [fired:2026-05-29 / adopted:2026-05-29 / deleted:-]
```

- 却下は `[fired:YYYY-MM-DD / rejected:YYYY-MM-DD (n) / cooldown_until:YYYY-MM-DD]` の形で残す。

---

## セキュリティ境界

- 生成スキルが同梱するスクリプトも、親の PII 検知フック（`hooks/pre-tool-use.js`）が **そのまま発火する**ことを前提にする。新規スキルが書き込み系ツールを呼んでも機密遮断は L1 フックで効く（[security-policies.md](../workflow/references/security-policies.md) §3）。
- 生成スキルは新たな権限を獲得しない。利用できるツールは親 `.claude/settings.json` の `permissions`（allow / ask / deny）に従う。**スキル化は権限境界を広げない。**
- スクリプトを同梱する場合は Node.js 単一実装とし、`ln -s` / `mkdir -p` / `cp` 等の POSIX コマンドを必須経路に置かない（クロスプラットフォーム実装規約 `cross-platform.md`、Mac / Windows 両対応）。
- パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。実体は専用フォルダの `.claude/skills/` に **Write ツールで直接配置**するだけで、symlink/コピーは作らない。
- 機密値（パスワード・トークン・個人情報）を SKILL.md 本文に直書きしない。「○○の認証情報を使う」等の **参照のみ** に留める。
- 索引 `~/.belta/skills/AUTHORED.md` はホーム側で `.gitignore` 対象。自作スキル実体は専用フォルダ `~/my-agent/.claude/skills/` 配下に置かれる（`/workflow-setup` が専用フォルダに `.gitignore` を用意し、誤コミットを防ぐ）。

## ファイル参照

- 生成 SKILL.md の構成・frontmatter 雛形・description 設計指針: [references/skill-template.md](references/skill-template.md)
- 専用フォルダのパス解決: [scripts/belta-init.js](../../scripts/belta-init.js)（`get agent_home`）
- 生成内容の品質補助: `skill-creator` スキル（Claude Code 標準）
- 親の権限境界: [.claude/settings.json](../../.claude/settings.json)
- テキスト指示で足りる繰り返し: [rule-learning](../rule-learning/SKILL.md)
- 隔離コンテキストへ委譲できる領域: [agent-learning](../agent-learning/SKILL.md)
- 既製スキルで賄える非効率作業: [skill-suggestion](../skill-suggestion/SKILL.md)
