---
name: release
description: >
  このリポジトリ（belta-workflow-agent プラグイン）のリリース作業を一貫実行する。
  バージョン更新（plugin.json + marketplace.json の 2 ファイル同期）→ コミット →
  push → GitHub Release（vX.Y.Z）作成まで。「リリースして」「バージョン上げて公開」
  「v0.X.Y を出して」等の明示的なリリース依頼、または /release で起動する。
  SKIP: コード修正・機能追加の依頼だけでリリースの明示依頼がないとき（修正の
  ついでに自動発火しない。リリースは公開操作のため必ず利用者の明示依頼を待つ）。
---

# プラグインのリリース（release）

このリポジトリのプラグインを新バージョンとして公開する手順。**公開操作（push・GitHub Release）を含むため、必ず利用者の明示的なリリース依頼で起動し、実行前にリリース内容を確認してもらう。**

## ワークフロー

### Step 1: リリース内容の確定

1. `git status --short` で作業ツリーを確認。リリースに含めるべきでない無関係な変更が混ざっていないか確かめる（混ざっていたら利用者に確認）。
2. 前回リリースからの差分を把握する:
   ```
   gh release list --repo belta-group/belta-workflow-agent --limit 3
   git log --oneline <前回タグ>..HEAD
   ```
3. 新バージョンを決める（semver）: バグ修正・表示改善＝patch ／ 機能追加＝minor ／ 互換性破壊＝major。

### Step 2: バージョン更新（2 ファイル必ず同期）

次の **2 ファイルの `version` を同じ値に**上げる。片方だけだと配布メタデータと実体が食い違う。

- `plugins/workflow/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`（`plugins[0].version`）

### Step 3: 検証

- JS を変更していれば `node --check <path>` を全変更ファイルに実行。
- 動作確認はリポジトリ側のスクリプトを直接 `node` 実行で行う（後述の罠を参照）。

### Step 4: コミットと push

- コミットメッセージはリポジトリの慣例に従う: `<type>: <日本語の要約> + vX.Y.Z`（例: `fix: 更新通知を systemMessage で利用者へ直接表示 + v0.4.2`）。
- `git push origin main`。

### Step 5: GitHub Release 作成

```
gh release create vX.Y.Z --repo belta-group/belta-workflow-agent --target main \
  --title "vX.Y.Z — <一言サマリ（日本語）>" --notes "<本文>"
```

リリースノートの形式（過去リリースに合わせる）:

- 日本語。`## <変更カテゴリ>` 見出し＋箇条書き。
- 「何が変わったか」に加えて「なぜ」（事故・誤読・詰まりの事例）を 1〜2 文で。
- 機能・記録形式に変更がなければその旨を明記。
- **末尾に更新手順の案内を必ず入れる**（下記の罠を参照）:
  > **既存利用者の更新には次の 2 コマンドが必要です**（marketplace の自動更新は現在機能しないため）。
  > 1. `claude plugin marketplace update belta-workflow-agent` — marketplace クローンを最新化
  > 2. 専用フォルダ（例: `~/my-agent`）で `claude plugin update workflow@belta-workflow-agent --scope local` — 参照を新バージョンへ切替
  >
  > 適用には Claude Code の再起動が必要です。`--scope local` を忘れると失敗します。

## 罠（Gotchas）

- **バージョンは 2 ファイル**。`plugin.json` だけ上げて `marketplace.json` を忘れると、過去に追従コミット（`chore: marketplace.json を v0.5.0 へ追従`）が必要になった。Step 2 で必ず両方同時に。
- **marketplace の autoUpdate は既知バグで機能しない**（`~/.claude/.../memory/claude-plugin-autoupdate-bug.md` 参照）。利用者へは手動更新の案内が唯一の更新経路なので、リリースノート末尾の案内を省略しない。
- **`claude plugin install` での再インストールは更新にならない**。既インストール環境では「already installed」で何もせず実体が古いまま残る（2026-06-11 の v0.5.3 配布時に判明）。正しい更新は (1) `claude plugin marketplace update belta-workflow-agent` でクローンと cache を最新化 → (2) 専用フォルダで `claude plugin update workflow@belta-workflow-agent --scope local` で installed_plugins.json の参照を切替、の 2 コマンド。`--scope local` は必須（既定の user スコープでは「not installed at scope user」で失敗。本プラグインはローカルスコープ運用のため）。適用には Claude Code の再起動が必要。
- **更新通知は version 比較で動く**。`hooks/session-start.js` (E) が同梱 `plugin.json` の `version` と `~/.belta/plugin-version.json` を比較して「v旧→v新」を 1 回通知する。version を上げ忘れると利用者に更新が伝わらない。
- **タグは `gh release create` がリモートに作る**。ローカルで `git tag` を打つ必要はなく、ローカルのタグ一覧はリリースより遅れていることがある（前回タグの特定は `git tag` でなく `gh release list` を使う）。
- **開発者の手元で動く `/usage` 等はインストール済みキャッシュ**（`~/.claude-profiles/<profile>/plugins/cache/.../<ver>/`）であり、リポジトリの修正は反映されていない。修正の動作確認はリポジトリのスクリプトを直接 `node plugins/workflow/scripts/<name>.js` で実行して行う。
- **リリースは公開操作**。push 前にコミット内容、Release 作成前にノート本文を利用者に見せる必要はないが、何をリリースするか（差分の要約と新バージョン番号）は Step 1 の時点で利用者と合意しておく。途中で無関係な未コミット変更が見つかったら混ぜずに確認する。
