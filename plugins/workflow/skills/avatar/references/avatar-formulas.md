# 育成アバター 算出式リファレンス

`avatar-stats.js` が用いる決定的な算出式の人間可読版。**この文書とコードの定数（`XP_WEIGHTS` / `BADGES` / `STAGE_*`）は一致させること。** 式を変えるときは両方を同時に直す。

> すべて決定的。同じ入力（`~/.belta/` の状態）からは常に同じ結果になる。LLM は関与しない。

## 経験値ソース（どのデータが何点になるか）

| ソース | 取得元 | 累積/直近 |
| --- | --- | --- |
| セッション数 | notes 日次ログ（+ 永続台帳 `avatar/history.json`） | 累積 |
| 依頼数 | notes 日次ログ（新規セッション分を台帳に累積） | 累積 |
| 学習ルール数（type別） | `rules/RULES.md` + 各 `<slug>.md` の `type:` | 現在値 |
| 採用エージェント数 | `agents/AGENTS.md` の `adopted:` マーカー | 現在値 |
| 自作スキル数 | `skills/AUTHORED.md` の索引行 | 現在値 |
| 事実訂正メモリ数 | `memory/MEMORY.md` の `##` 見出し（無ければ `*.md` 数） | 現在値 |
| ユーザーモデル項目数 | `user-model.md` の確信度付き箇条書き | 現在値 |
| 連続稼働ストリーク | 台帳 `active_days` の連続性 | 累積 |
| 稼働日数 | 台帳 `active_days` の総数 | 累積 |
| トークン量・キャッシュ率 | `audit/tokens/*.json` | 直近（剪定なし） |
| 訂正イベント数 | `audit/repeat/*.json` の `corrections` | 直近（7日保持） |
| ツール分布 | notes 依頼文のキーワード一致（台帳に最大値 union） | 累積 |

> **剪定耐性**: notes 日次ログは既定 14 日で剪定される。累積指標（セッション・依頼・稼働日・ツール分布）は `avatar/history.json` に union 追記して後退を防ぐ。ルール/エージェント/スキル/記憶は剪定されないので現在値をそのまま使う。

## XP の式（`XP_WEIGHTS`）

```
XP = 10*sessions + 4*requests + 25*rules_total
   + 40*agents_adopted + 50*skills_authored
   + 15*memory + 8*usermodel_items
   + 30*round(streak_current ** 1.2)
   + 12*active_days
   + 20*log10(1 + billable_token_estimate/1000)
   + 5*round(cache_hit_ratio*100)
```

- 質（学習成果）と多様性を重視。総トークン量は対数圧縮で「長く喋っただけ」が効きすぎないようにする。
- 連続稼働は指数（**1.2）でやや強めに報酬し、継続を促す。

## レベル境界

```
cumulativeXpForLevel(L) = 100 * (L-1) * L / 2
  → Lv1=0, Lv2=100, Lv3=300, Lv4=600, Lv5=1000, ...
level = 現XP 以下になる最大の L
```

進捗バー = `xp_into_level / xp_for_next`。

## 進化段階（見た目）

| stage_index | 名前 | 絵文字 | レベル帯 |
| --- | --- | --- | --- |
| 0 | たまご | 🥚 | Lv 1–4 |
| 1 | かけだし | 🐣 | Lv 5–9 |
| 2 | 一人前 | 🧒 | Lv 10–19 |
| 3 | 熟練 | 🧑 | Lv 20–34 |
| 4 | 達人 | 🧙 | Lv 35–49 |
| 5 | 賢者 | 👑 | Lv 50+ |

画像登録時は画像が「顔」になり、段階は周囲の枠・オーラ・王冠で表現する。

## 6 軸ステータス（各 0–100）

| 軸 | 意味 | 式 |
| --- | --- | --- |
| 継続 (stamina) | 連続稼働・稼働日 | `clamp(streak_current*8 + active_days*2)` |
| 知識 (wisdom) | ルール・記憶・ユーザーモデル | `clamp(rules*6 + memory*4 + usermodel*3)` |
| 自動化 (power) | エージェント・自作スキル | `clamp(agents_adopted*15 + skills_authored*18)` |
| 効率 (agility) | キャッシュ活用 | `clamp(cache_hit_ratio*100)` |
| 多才 (versatility) | 4ツール分布の均等さ | `clamp(activeToolFrac*50 + (1-gini)*50)` |
| 規律 (discipline) | 訂正の少なさ・訂正ルール化 | `clamp(100 - corrections*5 + mistakeFixRules*3)` |

`gini` は 4 ツール利用回数の不均等さ（0=均等, 1=偏り最大）。

## バッジ（`BADGES`・抜粋）

宣言テーブルで `cond(stats)` が真なら獲得。`req` は未獲得時に「次の目標」として提示する条件文。

- 👣 はじめの一歩 — セッション 1 回
- 🔥 一週間皆勤 / 🌟 月間皆勤 — 連続稼働 7 / 30 日
- 📚 ルール蒐集家 — 学習ルール 10 個
- 🩹 同じ轍を踏まず — 訂正ルール（mistake-fix）3 個
- 🤖 自動化の達人 — 採用エージェント＋自作スキル 5 個
- 🗡️ 四刀流 — Notion/Slack/GitHub/Drive すべて活用
- ⚡ キャッシュ番長 — キャッシュ率 70%
- 🧠 物覚えの達人 — 事実訂正メモリ 3 件
- 🌅 朝型 / 🦉 夜型 — その時間帯の稼働 5 回

（完全な一覧と階級〔bronze/silver/gold〕は `avatar-stats.js` の `BADGES` 配列を正本とする）

## スキルツリー（ツール習熟段階）

ツール別の依頼回数で 4 段階：`未解放(0)` / `解放(≥1)` / `育成中(≥5)` / `熟練(≥15)`。
