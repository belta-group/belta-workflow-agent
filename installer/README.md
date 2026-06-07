# Belta workflow agent — ダウンロード型インストーラー

「プラグイン導入前」に単体で動く**自己完結ブートストラップ**と、それをダブルクリックで
起動するための OS 別ランチャーです。

| ファイル | 役割 |
| --- | --- |
| `bootstrap.js` | 実体。メール入力 → `belta.co.jp` 検証 → `~/<@より前>-agent` 作成 → `~/.belta` 最小初期化 → **`claude` CLI があればプラグインをそのフォルダ限定で実インストール（`claude plugin install … --scope local`）**。最後に「作成フォルダで Claude を起動し `/workflow-setup` を実行してください」という案内を表示して終了（セットアップ自体は利用者が実行）。`claude` 不在時は `settings.local.json` を宣言的に書いてフォールバック。Node.js 単一実装で Mac / Windows 両対応。 |
| `install.command` | macOS 用ランチャー（Finder からダブルクリック）。Node を探して `bootstrap.js` を実行するだけの薄いラッパー。 |
| `install.bat` | Windows 用ランチャー（エクスプローラーからダブルクリック）。同上。 |

## 使い方（利用者）

1. お使いの OS のインストーラー一式（`bootstrap.js` ＋ ランチャー）をダウンロードして展開する。
2. macOS は `install.command`、Windows は `install.bat` をダブルクリックする。
   - macOS で「開発元を検証できません」と出たら、**右クリック →「開く」**を選ぶ（初回のみ）。
3. 画面の指示にしたがってメールアドレス（`@belta.co.jp`）を入力する。
4. `claude` コマンドが入っていれば、**インストーラーがプラグインを専用フォルダ限定で取り込む**。完了後、画面の案内にしたがって:
   1. `cd "~/<@より前>-agent"` で専用フォルダへ移動し `claude` を起動
   2. 起動した Claude で `/workflow-setup` を実行（プロフィール登録と 4 アプリの「許可」へ進む）
   - `claude` が見つからない場合は専用フォルダの準備までで止まり、同じ案内を表示する（フォルダを開けばプラグインは自動で取り込まれる）。

オプション: `--no-claude`（claude を使わず設定ファイルだけ書く）/ `--dry-run`（実行予定だけ表示）。

> **前提**: Claude Code（claude.ai の Max / Team / Enterprise プラン）が導入済みであること。
> このインストーラーはプラグインの「展開準備」までを自動化するもので、Claude Code 本体や
> OAuth 接続（各アプリの「許可」操作）は肩代わりできません。

## 開発者向け：単体実行 / 非対話

```bash
# 対話（メールを標準入力で聞く）
node installer/bootstrap.js

# 非対話（CI / 検証用）。--base で作成基点を隔離できる。
node installer/bootstrap.js --email system-bot@belta.co.jp --base /tmp/test --dry-run
```

実ロジックはすべて `bootstrap.js`。ランチャー（`.command` / `.bat`）は Node を探して起動する
だけの薄い層に留め、`cross-platform.md`（OS 依存コマンドを必須経路に置かない）の精神を保つ。
