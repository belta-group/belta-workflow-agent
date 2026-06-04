---
name: user-model
description: >
  蓄積した notes（~/.belta/notes/）から、利用者が明示していない暗黙の傾向
  （常用ツール・繰り返す業務・口ぐせ・段取りの好み・作業する時間帯）を観察ベースで抽出し、
  ~/.belta/user-model.md に追記・更新する。insights からの橋渡し、scheduler の週次ジョブ、
  または「私の傾向を覚えて」「使うほど馴染むようにして」等の発話で起動する。
  profile.md は上書きしない。明示ルールは rule-learning に委ねる。
---

# ユーザーモデル深化（user-model）

NousResearch/hermes-agent の Honcho dialectic user modeling 相当。**使うほど手に馴染む道具** にするため、notes に滲み出る利用者の傾向を観察ベースで蓄積し、運営モードの文脈に載せる。

- 対象: 利用者が **明示していない** が notes から読み取れる傾向（暗黙モデル）。
- 保存先: `~/.belta/user-model.md`（`profile.md` とは **別ファイル**）。
- 反映方針: **要約・追記のみ**。確信の持てない推測は反映せず候補に留める。

## 既存パーソナライズ機能との住み分け（重要）

| 機能 | 軸 | このスキルとの関係 |
| --- | --- | --- |
| `rule-learning` | 利用者が **明示** した恒常指示（「次回から」「毎回」） | user-model は **ルールを自動生成しない**。強い傾向を見つけたら「明示ルールにしますか？」と rule-learning へ橋渡しするだけ |
| `agent-learning` | 業務 **領域** の反復 → 専用 subagent | 委譲先が違う。user-model は委譲物を作らず、利用者像を更新する |
| `insights` | 過去 notes の **振り返り**（その場の要約） | insights が反復を見つけたら user-model に橋渡しする（出典を渡す） |

> 境界線: rule-learning は「利用者が言ったこと」、user-model は「利用者が言っていないが滲み出ていること」。user-model が勝手にルール化・自動化すると侵襲的になりすぎるため、**反映するのは人間可読の傾向メモだけ** に留める。

## いつ使うか（トリガ）

- `insights` スキルの末尾で利用者が「傾向として覚えて」を承認したとき（出典付きで委譲される）。
- `scheduler` の週次/隔週ジョブ「user-model 深化」から自動起動されたとき。
- 「私の傾向を覚えて」「使うほど馴染むようにして」「いつものやり方で」等の発話。

## ワークフロー

### Step 1: 走査（材料抽出）

`user-model` モードで notes を広めの窓で走査する：

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/notes-scan.js" --mode user-model
```

- 既定で直近 14 日を走査する（`--days N` で変更可）。
- 出力 JSON の `top_requests`（反復している依頼）・`sessions`（時系列・時間帯）・`topic_notes`（蓄積知識）を材料にする。
- fail-open。材料が乏しい（`session_count` が少ない）ときは更新せず「まだ傾向を判断する材料が少ない」と返す。

### Step 2: 傾向の抽出（LLM）

走査材料から、次の観点で **確信度付き** に傾向を言語化する。確信度が低いものは反映せず「候補」に留める。

- **常用ツール** — Notion / Slack / GitHub / Google Drive のどれをよく使うか。
- **繰り返す業務** — 頻出する依頼テーマ（意図でまとめる）。
- **段取りの好み** — 「まず確認してから送る」「箇条書きで欲しい」等、進め方の傾向。
- **口ぐせ・言い回し** — 依頼の表現の癖（あれば）。
- **作業の時間帯** — `sessions` の時刻から、朝に多い/夕方に多い等（弱い手がかりなので確信度は低めに）。

> 推測を断定しない。観察された回数・出典 notes を必ず添える。1〜2 回の出現は「候補」、3 回以上を「傾向」とする目安。

### Step 3: user-model.md へ反映（追記・統合）

[references/user-model-template.md](references/user-model-template.md) の構成に従い、`~/.belta/user-model.md` を Read（無ければ新規）→ 既存項目と **統合** して Write する。

- 既存の傾向と矛盾する観察が出たら、古い記述を消さずに「更新（前は X、最近は Y）」として残す（履歴性）。
- 各項目に `確信度`（高 / 中 / 低）と `出典`（notes の日付 2 件以上）・`更新日` を付ける。
- **profile.md は触らない**（オンボーディング正本。氏名・部署・機密度は user-model から書き換えない）。
- 確信度「低」は本文の「## 候補（未確定）」セクションに置き、本編に混ぜない。

> `user-model.md` はホーム直下に置く（`profile.md` と同格の人間可読な利用者像）。`~/.belta/` 配下は `.gitignore` 対象でリポジトリには出ない。パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。

### Step 4: rule-learning への橋渡し（任意）

確信度「高」かつ **利用者が明示すれば恒常ルールにできる** 傾向（例: 「常に箇条書きで欲しい」）があれば、`AskUserQuestion` で確認する：

> 「『○○』はあなたの一貫した好みのようです。明示ルールにして毎回適用しますか？」

承認 → [rule-learning](../rule-learning/SKILL.md) に委譲（user-model 自身はルールを作らない）。拒否 → 暗黙モデルのまま `user-model.md` に残す。

## 運営モードでの利用（読込）

運営モード起動時、`profile.md`・`RULES.md`・`AGENTS.md` と並べて `user-model.md`（存在すれば）を Read し、文脈に載せる。これにより、明示されていなくても利用者の段取り・好みに沿った応答ができる。**ただし user-model は「傾向」であり「指示」ではない**ので、明示指示（profile / rules）が優先する。

## 重要な注意事項

- 走査は `notes-scan.js` に委ねる（`cat`/`grep` を必須経路に置かない。Mac / Windows 両対応）。
- 反映するのは人間可読の傾向メモのみ。ルール生成・自動化・subagent 生成はしない（それぞれ rule-learning / skill-* / agent-learning の領分）。
- `profile.md` を上書きしない。
- 確信の持てない推測を断定しない。出典・確信度を必ず添える。
- 機密情報（個人を特定する PII 等）は user-model.md に書かない（傾向の抽象度に留める）。

## ファイル参照

- 走査エンジン: [scripts/notes-scan.js](../../scripts/notes-scan.js)
- user-model.md 雛形: [references/user-model-template.md](references/user-model-template.md)
- 振り返り（橋渡し元）: [insights](../insights/SKILL.md)
- 明示ルール化（橋渡し先）: [rule-learning](../rule-learning/SKILL.md)
- 定期実行（週次の自動深化）: [scheduler](../scheduler/SKILL.md)
