# Notion DB 設計ベストプラクティス（全パターン共通）

全パターン共通の設計原則とアンチパターン。Belta では「中央基盤に全員を合わせて失敗した」反省から、**過剰設計を避け、後から拡張できる最小構造**を是とする。各パターンの具体は [patterns/tasks.md](patterns/tasks.md) / [patterns/meetings.md](patterns/meetings.md) / [patterns/knowledge.md](patterns/knowledge.md)、型構文は [notion-property-reference.md](notion-property-reference.md) を参照。

## 1. 正規化原則（select / multi-select / status に寄せる）

- 取りうる値が**有限で決まっている**プロパティは `RICH_TEXT` にしない。
  - 単一選択 → `SELECT`、状態遷移 → `STATUS`、複数ラベル → `MULTI_SELECT`。
- 人は `PEOPLE`、日付は `DATE`、真偽は `CHECKBOX`、URL / メール / 電話は専用型を使う。テキストに入れない。
- 自由記述が本当に必要なものだけ `RICH_TEXT`。長文はプロパティではなく**ページ本文**に置く。
- 数値は `NUMBER`（必要なら `FORMAT 'dollar'` 等の表示書式）。集計対象は必ず `NUMBER`。

## 2. relation 設計

- **「本当に紐付ける必要があるもの」だけ**張る。代表的な関係：
  - Tasks → Projects（多対一）
  - Meetings → Tasks（一対多、Action Item 展開）
  - Knowledge → Knowledge（自己参照、関連知識）
- 双方向で辿りたいときは **DUAL**（two-way relation）にし、逆側のプロパティ名を明示する。
  - 例: `RELATION('<projects_ds_id>', DUAL 'タスク')` → Projects 側に「タスク」逆リレーションが生える。
- relation を張る前に相手 DB を `notion-fetch` してデータソース ID を取得する。**自己参照は DB 作成後に 2 段階**で追加する。
- relation はあくまで「参照」。コピーではないので、片方を消すとリンクだけ切れる（データは消えない）。

## 3. rollup の閾値

- rollup は relation 先の値を集計する（合計・件数・最大日付など）。便利だが**重い**。
- **参照先が 100 件を超える relation に rollup を多用しない**。表示・再計算が目に見えて遅くなる。
- 高頻度で見る指標（プロジェクトの未完タスク数、合計工数など）に絞る。一覧性のためだけの rollup は避ける。
- 「集計値を別 DB に焼き付けたい」だけなら、rollup より `FORMULA` や定期更新の方が軽いことがある。

## 4. DB View 3 セット

DB 作成後、用途別に最低 3 つの View を提案する：

| View | 型 | 用途 |
| --- | --- | --- |
| **Board** | ボード | `STATUS` / `SELECT` でカンバン化（Tasks のステータス別など） |
| **Timeline** | タイムライン / カレンダー | `DATE` を軸に期日・開催日を俯瞰 |
| **My filter** | テーブル（フィルタ済み） | 「自分が担当」「今週」など個人最適化フィルタ |

> View は DB の「見せ方」であり、データ本体は 1 つ。同じ DB を複数 View で使い回すのが正しい。用途ごとに DB を複製しない。

## 5. 命名規約

- **DB 名は英語・単数 or 複数の名詞**（`Tasks`, `Meeting Notes`, `Knowledge Base`）。API / relation 参照で扱いやすい。
- **プロパティ名は日本語可**（利用者が読む面）。ただし表記を統一する（「担当者」で揃え「担当」「アサイン」を混在させない）。
- `STATUS` / `SELECT` の選択肢は短く・排他的に。色は意味と対応させる（完了=green、要対応=red など）。
- `UNIQUE_ID` の PREFIX は大文字 3〜4 文字（`TASK`, `PRJ`, `KB`）。

---

# アンチパターン（全体）

設計レビュー時にこれらを検出したら作り直しを提案する。

| アンチパターン | 何が起きるか | 正しい設計 |
| --- | --- | --- |
| **全部 1 つの DB に詰め込む** | タスクも議事録もナレッジも同居 → プロパティが噛み合わず空欄だらけ、View も作れない | 役割ごとに DB を分け relation で繋ぐ |
| **Status / Category をテキスト**（`RICH_TEXT`） | 表記揺れで集計・絞り込み不能、Board View 不可 | `STATUS` / `SELECT` に正規化 |
| **担当者・出席者をテキスト** | 人事異動・表記揺れで破綻、メンション不可 | `PEOPLE` |
| **過剰な relation** | 何でも相互リンクして依存が複雑化、メンテ不能 | 本当に辿る関係だけ DUAL で張る |
| **大規模 relation への rollup 乱用** | 100 件超で表示・再計算が重い | 高頻度指標に限定、または FORMULA |
| **長文をプロパティに入れる** | テーブルが横長で読めない | 要約のみプロパティ、詳細はページ本文 |
| **用途ごとに DB を複製** | 同じデータが分散し集計不能 | 1 DB + 複数 View |
| **機密度プロパティ無し**（Knowledge） | 極秘文書が公開 View に混入 | `機密度 SELECT` 必須化 + PII フックで多重防御 |
| **鮮度管理プロパティ無し**（Knowledge） | 陳腐化した手順が放置 | `最終レビュー DATE` 必須 + 棚卸し View |
