---
name: avatar
description: >
  使い込むほど成長する「育成アバター」とダッシュボードを扱う。~/.belta/ に貯まった活動
  データ（セッション・依頼・学習ルール・自動生成エージェント・自作スキル・記憶・トークン量・
  連続稼働日）から、レベル・XP・6軸ステータス・実績バッジ・スキルツリーを再計算し、自己完結
  HTML（~/.belta/dashboard.html）を生成する。「アバター」「ダッシュボード」「レベル」
  「成長」「どれくらい育った」「実績」「バッジ」「アバターの名前/画像を変えたい」等の発話、
  または /avatar コマンドで起動。希望時のみ匿名化して GitHub Pages 公開も担う。
---

# 育成アバター（avatar）

belta は使うほど学習データ（ルール・エージェント・スキル・notes・記憶）が貯まる。本スキルはそれを **RPG 育成風のアバター**に翻訳し、成長を可視化する。

- 集計・HTML 生成は**決定的な Node スクリプト**が担う（LLM トークンを消費しない）。`avatar-stats.js`（集計）→ `avatar-render.js`（HTML）。
- 自然文の「成長日記」だけ LLM（[insights](../insights/SKILL.md) スキルに相乗り）。

この二層分担は、既存の「notes-scan.js（決定的走査）＋ insights（LLM 要約）」と同じ。

## いつ使うか（トリガ）

- `/avatar` / `/avatar setup` / `/avatar --publish` を実行したとき
- 「アバター」「ダッシュボード」「どれくらい育った」「レベル」「実績/バッジ」「成長を見たい」等の発話
- アバターの「名前を付けたい/変えたい」「画像を設定したい」と言われたとき → `setup` 手順へ

## ワークフロー

### Step 1: 集計（決定的）

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/avatar-stats.js" --md
```

- `~/.belta/` 配下を走査し、レベル・XP・6軸・バッジ・ストリーク・スキルツリーを計算して人間可読サマリを返す（`--json` で構造化）。
- fail-open：データが無くても Lv.1「たまご」を返す。剪定耐性のため `~/.belta/avatar/history.json`（永続台帳）に稼働日・累積セッションを union 追記する（副作用はこれだけ）。
- 算出式の詳細は [references/avatar-formulas.md](references/avatar-formulas.md)。

### Step 2: ダッシュボード再生成（決定的）

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/avatar-render.js"
```

- `~/.belta/dashboard.html` を自己完結 HTML（CDN 依存ゼロ）で再生成する。アバター画像があれば base64 で埋め込み、レーダーチャート・稼働ヒートマップ・バッジ・スキルツリーを描画。
- 出力 JSON の `out` がパス。**OS の open コマンドは打たず**、「`~/.belta/dashboard.html` をブラウザで開いてください」とパスを案内する（POSIX: `$HOME` / Windows: `%USERPROFILE%` から解決）。

### Step 3: 成長サマリの提示

Step 1 のサマリを材料に、会話で短く励ます（結論先出し）：

- 現在の Lv と段階（たまご→かけだし→一人前→熟練→達人→賢者）。
- 直近で増えたもの（ルール／エージェント／スキル／連続稼働）。
- 新しく獲得したバッジ、次に狙えるバッジ（`locked` の `req` を 1〜2 個）。

### Step 4: 名前・画像の設定（`setup` 指定時、または未設定時）

アバターの名前・ポートレート画像を登録する。**初回オンボーディング（`/workflow-setup` の Step 1.6）でも同じ手順**を使う。

1. 名前を尋ねる（任意。未回答ならデフォルト名「あいぼう」）。
2. 画像を尋ねる（任意）：「お好みの画像があればファイルのパスを貼り付けてください（png/jpg/webp/gif/svg・2MB 以下）。後からでも変更できます」。
3. 取得した値で実行：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/avatar-setup.js" --name "<名前>" [--image "<画像の絶対パス>"]
   ```

   - `avatar.yaml`（`~/.belta/avatar.yaml`）に名前・画像ファイル名を保存。画像は `~/.belta/avatar/base.<ext>` に複製。
   - 非対応形式・サイズ超過は名前のみ保存して理由を返す（fail-open）。
4. 「画像はあなたのPC内（`~/.belta/avatar/`）にのみ保存され、GitHub 公開時は既定で含めません」と一言添える。

### Step 5: GitHub Pages 公開（`--publish` 指定時のみ・既定オフ）

**機密の壁を必ず守る。** 依頼文・PII・本名・顔写真を外に出さない。

1. 機能が許可されているか確認：`node "${CLAUDE_PLUGIN_ROOT}/scripts/belta-init.js" get feature_avatar_publish` が `true` でなければ、公開は行わず「設定で公開を有効化してください」と案内して終了。
2. 匿名化：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/avatar-anonymize.js" --in <stats.json> --out docs/public/avatar-stats.json
   ```

   - 出力は**数値とバッジ id だけ**（名前・画像・依頼文・slug・時刻は既定で除外）。
3. **目視確認**：生成された `docs/public/avatar-stats.json` を Read し、文字列値（本名・業務名など）が混入していないかを確認する。
4. `AskUserQuestion` で「この内容を GitHub Pages に公開してよいですか？（URL を知る人は誰でも閲覧できる可能性があります）」と最終確認。
5. 承認時のみ `git add docs/public/avatar-stats.json docs/avatar.md` → `git commit` → `git push`（いずれも `ask` 権限。プッシュで既存 `.github/workflows/docs.yml` が自動デプロイ）。
6. 名前・画像も公開したい明示があれば `--include-name` / `--include-image` を付けるが、その都度 `AskUserQuestion` で確認する。

## 重要な注意事項

- 集計・描画は必ず同梱スクリプトに委ねる（`cat`/`sed` を必須経路に置かない。Mac / Windows 両対応）。
- 読み取り専用が原則。書き込むのは `~/.belta/dashboard.html`・`~/.belta/avatar/`・（公開時のみ）`docs/public/`。
- データが乏しいときは事実を創作せず、「まだ育ち始めです」と正直に返す。
- 公開は既定オフ。`docs.yml` の注記どおり、private リポでも Pages は URL 既知なら閲覧され得る前提で、匿名数値のみ・三重ゲート（コード／gitleaks CI／LLM 確認）を守る。

## ファイル参照

- 集計エンジン: [scripts/avatar-stats.js](../../scripts/avatar-stats.js)
- HTML 生成: [scripts/avatar-render.js](../../scripts/avatar-render.js)
- 名前・画像設定: [scripts/avatar-setup.js](../../scripts/avatar-setup.js)
- 匿名化（公開用）: [scripts/avatar-anonymize.js](../../scripts/avatar-anonymize.js)
- 算出式の詳細: [references/avatar-formulas.md](references/avatar-formulas.md)
- 成長日記（LLM 自然文）: [insights](../insights/SKILL.md)
- 定期更新（日次/週次ジョブ）: [scheduler](../scheduler/SKILL.md)
- 正規化・notes パーサ（集計が再利用）: [hooks/repeat-util.js](../../hooks/repeat-util.js)
