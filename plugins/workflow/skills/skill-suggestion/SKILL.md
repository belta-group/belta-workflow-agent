---
name: skill-suggestion
description: >
  既存スキルで賄えない非効率な手作業の繰り返し（PDF 抽出・スプレッドシート集計・議事録
  要約・スライド作成 等）や、「〜できる？」「〜のやり方」「もっと楽に」「自動化できない？」
  といった能力探索の発話を検知し、適合する業務効率化スキルを find-skills 経由で探して
  提案・（信頼ソースに限り）インストールする。workflow スキルから委譲される。
---

# 自動スキル提案（skill-suggestion）

[rule-learning](../rule-learning/SKILL.md)（テキスト指示）でも [agent-learning](../agent-learning/SKILL.md)（業務領域の専用エージェント化）でも埋まらない、**「そもそも今の手元の道具では非効率」** な繰り返し作業を検知し、適合する **インストール可能なスキル** を提案する。承認を得たら、信頼ソースに限り自動インストールまで行う。

> 提案するのは「能力（スキル）の追加」。新しい振る舞いの記憶（rule）でも、領域専用の委譲先（agent）でもない点で前 2 スキルと役割が分かれる。

## いつ使うか（検知トリガ）

### トリガ A: 既存スキルで賄えない非効率な手作業の繰り返し

利用者が、手元のスキルでは非効率にこなしている定型作業を **2 回以上** 繰り返している：

- PDF からの表・テキスト抽出、OCR
- スプレッドシート（xlsx / csv）の集計・整形
- 議事録の要約、長文の要約
- スライド（pptx）・ドキュメント（docx）の作成
- 画像・図表の生成

`~/.belta/notes/` の直近記録も参照し、同種タスクの再来を捉える。

### トリガ B: 能力探索フレーズの検出

利用者の発話に、能力の不足や探索を示す表現が含まれる：

- 「〜できる？」「〜って可能？」「〜のやり方」「どうやって〜する」
- 「もっと楽に」「自動化できない？」「効率化したい」「毎回手作業で大変」

### トリガ C: 主要業務との照合

トリガ A/B で捉えた同種タスクを、`~/.belta/profile.md` の **主要業務** と照合し、利用者の業務に効く候補に重み付けする。業務と無関係な思いつきは提案しない。

---

## 自動化フロー

### Step 1: 既存スキルとの重複チェック

提案の前に、**すでに利用可能なスキルで賄えないか** を確認する。利用可能スキル一覧（セッションで使えるスキル群）に同等機能があれば、新規導入を提案せず **そのスキルの利用を案内**して終了する（重複提案の抑止）。

> 例: PDF 抽出は `pdf` スキル、スプレッドシートは `xlsx` スキル、議事録要約は `workflow` 内で完結することが多い。まず手元の道具で足りるかを必ず確認する。

### Step 2: 候補探索（find-skills 経由）

手元で賄えないと判断したら、`find-skills` スキル（Claude Code 標準で利用可能）を使ってインストール可能なスキルを検索する。候補ごとに **出典・提供元・要求権限** を把握する。

### Step 3: 信頼ソース allowlist の判定

候補を [references/skill-allowlist.md](references/skill-allowlist.md) の allowlist に照合する：

- **allowlist 内**（社内 marketplace `belta-group/*` + Anthropic 公式）→ 自動インストール提案の対象。
- **allowlist 外**（未審査・第三者）→ **自動インストールしない**。提案のみに留め、手動導入の手順と注意点を案内する。

### Step 4: 提案（AskUserQuestion）

allowlist 内候補について、利用者に確認する。**要求権限・提供元を必ず併記**する：

> 「`<skill>` を導入すると○○が効率化できます（提供元: `<source>` / 要求権限: `<permissions>`）。インストールしますか？」

- **AskUserQuestion**（インストールする / 今回は不要、+ 自由記述）で出す。
- 一度に 1 候補。最も適合度の高いものに絞る。

### Step 5-a: 承認 → インストール + 有効化確認

1. インストールを実行する。marketplace のスキルは Claude Code 標準のスラッシュコマンドを使う（OS 非依存・クロスプラットフォーム）：

   ```
   /plugin install <skill>@<marketplace>
   ```

   marketplace 未登録なら先に `/plugin marketplace add <belta-group/...>` を案内する。スキル単体配置の場合も Claude Code の標準機構に従い、`mkdir` / `cp` 等の OS 依存コマンドを必須経路に置かない。
2. **有効化・読み込み確認**: `/plugin`（または利用可能スキル一覧）で当該スキルが現れることを確認する。
3. `~/.belta/skills/SKILLS.md` に **installed** を記録する（後述）。
4. 「`<skill>` を導入しました。次回から○○はこれで効率化します」と返す。

### Step 5-b: 拒否 → rejected 記録 + 冷却

`SKILLS.md` に `rejected` を記録する。**同一スキルを 3 回連続で却下されたら 14 営業日の冷却**（提案停止）に入れる。

---

## SKILLS.md の管理（常に LLM 文脈に読込）

`~/.belta/skills/SKILLS.md` は起動時に毎回 Read されるインデックス。提案・導入・却下・削除を追跡する。

### 初期化（無ければ作成）

```markdown
# SKILLS — スキル提案・導入索引

このファイルは `skill-suggestion` が自動生成・追記する。起動時に毎回読み込まれ、
suggested / installed / rejected / uninstalled を追跡する。

<!-- 追記形式: - <skill> — <用途> [suggested:YYYY-MM-DD / installed:YYYY-MM-DD / source:<provider>] -->
```

### 追記 1 行の形式

```
- pdf — PDF からの表抽出 [suggested:2026-05-29 / installed:2026-05-29 / source:anthropic]
```

- 却下は `[suggested:YYYY-MM-DD / rejected:YYYY-MM-DD (n) / cooldown_until:YYYY-MM-DD]`。
- アンインストールを検知したら `uninstalled:YYYY-MM-DD` を追記する。

---

## セキュリティ

- **allowlist 外スキルは自動インストール禁止**。提案のみに留め、手動導入を案内する（[references/skill-allowlist.md](references/skill-allowlist.md)）。
- インストール前に **提供元・要求権限** を必ず提示し、利用者承認を得る。無断インストールしない。
- インストール直後の新規スキルにも、親の PII 検知フック（`hooks/pre-tool-use.js`）が **そのまま適用される**ことを前提にする。新規スキルが書き込み系ツールを呼んでも、機密遮断は L1 フックで効く（[security-policies.md](../workflow/references/security-policies.md) §3）。
- パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決する。インストールは Claude Code 標準機構（`/plugin`）に委ね、OS 依存コマンドを必須経路に置かない（Mac / Windows 両対応）。
- `~/.belta/` 配下は `.gitignore` 対象。リポジトリにコミットしない。

## ファイル参照

- 許可 marketplace / 提供元 / 既定推奨スキル一覧: [references/skill-allowlist.md](references/skill-allowlist.md)
- 候補探索: `find-skills` スキル
- テキスト指示で足りる繰り返し: [rule-learning](../rule-learning/SKILL.md)
- 業務領域そのものの繰り返し: [agent-learning](../agent-learning/SKILL.md)
