# memory 雛形（事実訂正メモリ）

`hallucination-memory` スキルが `~/.belta/memory/` を生成・更新するときの雛形。
「過去に間違えた事実（wrong）」と「正しい事実（correct）」を必ず並記し、二度と同じ誤りを
犯さないための照合材料にする。

---

## 個別ファイル `~/.belta/memory/<slug>.md`

詳細な背景・出典が必要な事実に使う（短い 1 文の事実は MEMORY.md に直接 1 行で残してよい）。

```markdown
---
name: <slug>                      # kebab-case（例: deploy-target-host）
topic: <短いトピック名>            # 例: デプロイ先ホスト
occurrences: <観測回数（2 以上）>
recorded_at: <YYYY-MM-DD>
sources:                          # 検知元の notes / セッション（2 件以上が望ましい）
  - notes/YYYY-MM-DD.md
  - notes/YYYY-MM-DD.md
---

## 誤った主張（wrong）— 二度と述べない
<エージェントが過去に言ってしまった誤り。何を言ってはいけないかを具体的に>

## 正しい事実（correct）
<利用者が訂正した、確定している正しい事実>

## 補足（任意）
<背景・なぜ間違えやすいか・関連する正しい情報など。PII や機密値そのものは書かない>
```

## 索引 `~/.belta/memory/MEMORY.md`

運営モードで毎回読み込まれる。1 事実 1 行。

```markdown
# MEMORY — 事実訂正メモリ（ハルシネーション再発防止）

このファイルは hallucination-memory が記録・追記する。運営モードで毎回読み込まれる。
各行は「過去に間違えた事実」と「正しい事実」。応答前に必ず照合し、誤った主張を二度と述べないこと。

<!-- 形式: - <topic>: ❌<誤った主張> → ✅<正しい事実> [src:YYYY-MM-DD / occ:n / recorded:YYYY-MM-DD]（詳細は <slug>.md） -->

- デプロイ先ホスト: ❌ deploy は staging-a に出す → ✅ 本番デプロイ先は prod-b（staging-a は検証専用） [src:2026-06-04 / occ:2 / recorded:2026-06-04]（詳細は deploy-target-host.md）
```

## 記録ルール

- 記録対象は **事実の誤り** のみ。好み・書式・口調の訂正は rule-learning へ（住み分け）。
- **検証済みの事実** だけを残す。利用者が確信を持って訂正したものに限る（不確かな推測を記憶しない）。
- **PII・機密値そのもの**（パスワード／カード番号／マイナンバー等）は書かない。抽象化して残す。
- 同じトピックの既存行があれば **更新**（重複行を増やさない）。`occurrences` を加算する。
- MEMORY.md は 200 行を目安に統廃合する。
- パスはホームディレクトリ環境変数（POSIX: `$HOME` / Windows: `%USERPROFILE%`）から解決し、Write ツールで書く（`mkdir`/`touch` を必須経路に置かない。Mac / Windows 両対応）。
