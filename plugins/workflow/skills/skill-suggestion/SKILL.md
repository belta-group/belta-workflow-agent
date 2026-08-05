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
>
> さらに、本スキルが扱うのは **既にある配布済みスキルの探索・導入** に限る。手元の業務に合わせて **スキルを新規に自作** するのは [skill-authoring](../skill-authoring/SKILL.md) の領分。既製品で足りるなら本スキル（導入）、見つからず専門業務が 3 回以上反復するなら skill-authoring（自作）へ回す。

## いつ使うか（検知トリガ）

### トリガ A: 既存スキルで賄えない非効率な手作業の繰り返し

利用者が、手元のスキルでは非効率にこなしている定型作業を **2 回以上** 繰り返している（**同一セッション内での 2 回以上の繰り返しも、別々の機会での繰り返しも対象**）：

- PDF からの表・テキスト抽出、OCR
- スプレッドシート（xlsx / csv）の集計・整形
- 議事録の要約、長文の要約
- スライド（pptx）・ドキュメント（docx）の作成
- 画像・図表の生成

同一セッション内で 2 回目を認識した時点でその場で候補化してよい。あわせて `~/.belta/notes/` の直近記録も参照し、セッションをまたぐ同種タスクの再来も捉える。

### トリガ B: 能力探索フレーズの検出

利用者の発話に、能力の不足や探索を示す表現が含まれる：

- 「〜できる？」「〜って可能？」「〜のやり方」「どうやって〜する」
- 「もっと楽に」「自動化できない？」「効率化したい」「毎回手作業で大変」

### トリガ C: 主要業務との照合

トリガ A/B で捉えた同種タスクを、`~/.belta/profile.md` の **主要業務** と照合し、利用者の業務に効く候補に重み付けする。業務と無関係な思いつきは提案しない。

### トリガ D: 能動起動（`/skill-suggest`）

利用者が `/skill-suggest` で **能動的に** 起動した場合は、トリガ A/B/C の反復を待たず本フローに合流する。部署（`profile.md` の `department`）・困りごと・直近 notes を起点に、下の **Step 1.5（カタログ照合）から開始**する。オンボーディング（`/workflow-setup` の部署スキル提案）も同様にカタログ照合経由で本フローに合流する。

---

## 自動化フロー

### Step 1: 既存スキルとの重複チェック

提案の前に、**すでに利用可能なスキルで賄えないか** を確認する。利用可能スキル一覧（セッションで使えるスキル群）に同等機能があれば、新規導入を提案せず **そのスキルの利用を案内**して終了する（重複提案の抑止）。

> 例: PDF 抽出は `pdf` スキル、スプレッドシートは `xlsx` スキル、議事録要約は `workflow` 内で完結することが多い。まず手元の道具で足りるかを必ず確認する。

### Step 1.5: カタログ照合（catalog-scan・決定的・まず最初に）

手元の道具で足りないと判断したら、**find-skills の前に** キュレート済みカタログ（[references/skills-catalog.json](references/skills-catalog.json)）を決定的に照合する。読み取り専用・オフライン・即時：

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/catalog-scan.js" [--category <c>] [--department <slug>] --available-only
```

- 返る JSON の `candidates` には各候補の `source` / `auto_installable`（source から再計算）/ `required_permissions` / `status`（new/installed/rejected）/ `cooldown_until` が付く。**冷却中・導入済みはヘルパー側で既に除外済み**なので、ここに出た候補はそのまま提案検討に進めてよい。
- ヒットがあれば、最も適合度の高い候補を Step 3（allowlist 判定）→ Step 4（提案）へ。
- `catalog_available:false`（カタログが読めない）か、フィルタ結果が空でカタログ外の能力が要るときだけ Step 2（find-skills）に進む。

### Step 2: 候補探索（find-skills 経由・カタログ外のフォールバック）

カタログにヒットしない／カタログ外の能力をネットワーク探索したいときだけ、`find-skills` スキル（Claude Code 標準で利用可能）を使ってインストール可能なスキルを検索する。候補ごとに **出典・提供元・要求権限** を把握する。catalog-scan が決定的に答えられる範囲（既知スキルの提示と allowlist/冷却判定）と、find-skills に倒す範囲（カタログ外のネットワーク探索）を混ぜないこと。

### Step 3: 信頼ソース allowlist の判定

候補を [references/skill-allowlist.md](references/skill-allowlist.md) の allowlist に照合する。**Step 1.5 のカタログ候補は `catalog-scan.js` が `source` から再計算した `auto_installable` を信頼根拠として持つ**ので、それをそのまま使ってよい（冷却・導入済みも既に除外済み）。find-skills 由来のカタログ外候補は、ここで `source` を allowlist に照合する：

- **allowlist 内**（社内 marketplace `belta-group/*` + Anthropic 公式 ＝ `auto_installable:true`）→ 自動インストール提案の対象。
- **allowlist 外**（未審査・第三者 ＝ `auto_installable:false`）→ **自動インストールしない**。提案のみに留め、手動導入の手順と注意点（[skill-allowlist.md](references/skill-allowlist.md) の目視確認チェックリスト）を案内する。

### Step 3.5: 安全性チェック（skill-audit・決定的）

**allowlist 外の候補を手元に取得した場合、および導入直後は必ず**、静的スキャナで中身を機械的に洗い出す（読み取り専用・fail-open）：

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/skill-audit.js" --dir <スキルフォルダ>
```

- 破壊操作 / 認証情報の外部送信 / 難読化実行 / 設定改変 / frontmatter の妥当性 / OS 依存コマンドを `high` / `medium` / `info` で返し、`~/.belta/audit/skills/<name>.json` に保存する。
- **`high` があれば、その行を利用者に提示してから採否を確認する**（勝手に「大丈夫です」と判断しない）。用途に照らして妥当でなければ導入を見送る。
- スキャナは**検出までで判定はしない**。通ったことは安全の保証ではない（動的にコードを取得する等は検出できない）。allowlist 内の候補でも、導入後に走らせておくと許可ゲートの確認ダイアログに結果が出て以後の判断が楽になる。

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

- キュレート済みスキルカタログ（正本）: [references/skills-catalog.json](references/skills-catalog.json)
- カタログ照合ヘルパー（決定的・読み取り専用）: `scripts/catalog-scan.js`
- 安全性チェック（決定的な静的スキャナ）: `scripts/skill-audit.js`
- スキル許可ゲート（未記録スキルの起動を確認）: `hooks/skill-gate.js` ＋ `.claude/skill-policy.json`
- 許可 marketplace / 提供元 / 既定推奨スキル一覧 / 非公式の目視確認チェックリスト: [references/skill-allowlist.md](references/skill-allowlist.md)
- 能動起動の入口コマンド: `/skill-suggest`（`commands/skill-suggest.md`）
- 候補探索（カタログ外フォールバック）: `find-skills` スキル
- テキスト指示で足りる繰り返し: [rule-learning](../rule-learning/SKILL.md)
- 業務領域そのものの繰り返し: [agent-learning](../agent-learning/SKILL.md)
- 既製品が無い専門業務を専用スキルとして自作する: [skill-authoring](../skill-authoring/SKILL.md)
