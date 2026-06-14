# 自作スキルの生成雛形（skill-authoring 用）

`skill-authoring` スキルが、消去法ゲートを通過した専門業務を専用フォルダの
`<agent_home>/.claude/skills/<name>/` に新規生成する際の **ディレクトリ構成**・**SKILL.md frontmatter 雛形**・**description 設計指針**。

中身の記述品質は Claude Code 標準の `skill-creator` スキルに委譲してよい。本雛形は
BELTA プラグインの規約（配置・クロスプラットフォーム）に合わせるための最小要件を定める。

---

## ディレクトリ構成

```
<agent_home>/.claude/skills/<name>/
├── SKILL.md            # 必須。frontmatter + 手順本文
├── references/         # 任意。参照知識（発火時に必要時だけ読まれる）
│   └── *.md
└── scripts/            # 任意。補助スクリプト（Node.js 単一実装に限る）
    └── *.js
```

- `<name>` は kebab-case。`~/.belta/skills/AUTHORED.md`（索引）のキーと一致させる。`<agent_home>` は専用フォルダの絶対パス（`belta-init.js get agent_home` で解決）。
- `references/` `scripts/` は不要なら作らない。**最小構成は `SKILL.md` 1 枚**。

---

## SKILL.md frontmatter 雛形

```markdown
---
name: <name>                       # kebab-case。AUTHORED.md / ディレクトリ名と一致
description: <いつ自動発火するか。業務ドメインの語を入れ、狭く具体的に書く（下記指針）>
source_notes:                      # 生成根拠にした notes（再学習・監査用、3 件以上）
  - .belta/notes/<YYYY-MM-DD>.md
  - .belta/notes/<YYYY-MM-DD>.md
  - .belta/notes/<YYYY-MM-DD>.md
created_at: <YYYY-MM-DD>
---

# <スキルの目的（1 行）>

## いつ使うか
<発火条件を具体的に。誤発火を避けるため「使わない場面」も書くとよい>

## 手順
<この業務の定型手順。複数ステップ・専門知識をここに集約する>

## 出力様式・禁止事項
<期待する成果物の形式、やってはいけないこと>
```

> `model` フィールドは置かない（スキルは subagent と異なり、発火中の文脈のモデルで動く）。
> 隔離した文脈での重い委譲が要るなら、そもそも agent-learning を選ぶべき（消去法ゲート条件 3）。

---

## description 設計指針（最重要）

スキルの自動発火精度は `description` で決まる。スキルは最も侵襲的（主コンテキストに読み込まれ
自動発火する）なので、**狭く・具体的に**書くことが誤発火を防ぐ唯一の防御になる。

- **業務ドメインの語を必ず入れる**（例: 「月次売上レポート」「契約書の条項抽出」）。汎用語だけにしない。
- **発火する場面を限定する**。「〜のとき」「〜を求められたとき」と条件を明示する。
- **やらない場面を書いてもよい**（例: 「単発の一覧取得には使わない」）。
- 既製スキル・他の自作スキルと **発火条件が重ならない** ことを確認する。重なるなら統合を検討する。

> 良い例: 「毎月の売上 CSV から定型の月次レポート（前月比・部門別集計つき）を生成するとき」
> 悪い例: 「レポートを作る」（広すぎて他の依頼でも誤発火する）

---

## スクリプト同梱時の規約（クロスプラットフォーム）

`scripts/` を置く場合、プラグインのクロスプラットフォーム実装規約（`cross-platform.md`）を必ず守る：

- `#!/usr/bin/env node` の **Node.js 単一実装**。`.sh` / `.ps1` / `.bat` の二重メンテをしない。
- ファイル操作は `fs` API、パス連結は `path.join`、ホームは `os.homedir()`。
- `mkdir -p` / `cp` / `ln -s` / `touch` / `cat` 等の OS 依存コマンドを必須経路に置かない。
- 例外時も安全側に倒す（落とさず JSON 等で状態を返す）。

---

## 権限・セキュリティ（生成内容に必ず反映）

- 生成スキルは新たな権限を獲得しない。ツール利用は親 `.claude/settings.json` の
  `permissions`（allow / ask / deny）に従う。**スキル化は権限境界を広げない。**
- 同梱スクリプトが書き込み系・外部送信を行っても、親の PII 検知フック
  （`hooks/pre-tool-use.js`）が発火することを前提にする（防御を肩代わりしない）。
- 機密値（パスワード・トークン・個人情報）を本文に直書きしない。**参照のみ**に留める。
- `~/.belta/skills/` 配下は `.gitignore` 対象。リポジトリにコミットしない。
