# Belta workflow agent — ダウンロード型インストーラー

「プラグイン導入前」に単体で動く**自己完結ブートストラップ**と、それをダブルクリックで
起動するための OS 別ランチャーです。

| ファイル | 役割 |
| --- | --- |
| `bootstrap.js` | 実体。メール入力 → `belta.co.jp` 検証 → `~/<@より前>-agent` 作成 → `~/.belta` 最小初期化 → **git 確認（不在なら自動導入を促す。後述）** → **`claude` CLI があればプラグインをそのフォルダ限定で実インストール（`claude plugin install … --scope local`）**。最後に「作成フォルダで Claude を起動し `/workflow-setup` を実行してください」という案内を表示して終了（セットアップ自体は利用者が実行）。**`claude` 不在時は公式インストーラーで自動導入**（公式ネイティブ → npm の順。macOS は Homebrew / ネイティブを選択可）し、`~/.local/bin` を PATH に通したうえで「ターミナルを再起動してから再実行/フォルダを開いてください」と案内する。自動導入も失敗した場合のみ `settings.local.json` を宣言的に書き、手動導入コマンドを案内する。Node.js 単一実装で Mac / Windows 両対応。 |
| `install.command` | macOS 用ランチャー（Finder からダブルクリック）。Node を探して `bootstrap.js` を実行する薄いラッパー。**Node 不在時は Homebrew があれば自動インストールを提案し、無ければ nodejs.org のダウンロードページを開いて再実行を案内**する。 |
| `install.bat` | Windows 用ランチャー（エクスプローラーからダブルクリック）。同上。**Node 不在時は winget で自動インストールを試み、失敗したら nodejs.org のダウンロードページを開いて再実行を案内**する。 |

### 前提ツールの自動確保（node / git）

クリーンな環境（node も git も無い）でも詰まらないよう、前提ツールを段階的に確保する。

- **Node.js** — bootstrap.js 自体の実行に必要なため、**ランチャー側**で検知・案内する（上表）。
- **git** — `claude plugin marketplace add` が marketplace リポジトリを **git clone で取得する**ため必須。bootstrap.js が手順 (1.5) で確認し、不在なら自動導入を促す：
  - **macOS**: git の実体は Xcode Command Line Tools（CLT）。`xcode-select -p` で有無を判定し（git 直接実行は意図しないダイアログを誘発するため避ける）、不在なら `xcode-select --install` で OS 標準ダイアログを開き、完了を Enter で確認しながら待つ。
  - **Windows**: `winget install --id Git.Git` で自動導入。同一プロセスに PATH が反映されない場合は「新しいウィンドウで再実行」を案内。
  - いずれも確保できないまま終わる場合は、`settings.local.json` を宣言的に書いた上で「git 導入 → 再実行」を案内して終了する（fail-open。再実行は冪等に続きから進む）。

## 使い方（利用者）

1. お使いの OS のインストーラー一式（`bootstrap.js` ＋ ランチャー）をダウンロードして展開する。
2. macOS は `install.command`、Windows は `install.bat` をダブルクリックする。
   - macOS で「開発元を検証できません」と出たら、**右クリック →「開く」**を選ぶ（初回のみ）。
3. 画面の指示にしたがってメールアドレス（`@belta.co.jp`）を入力する。
4. `claude` コマンドが入っていれば、**インストーラーがプラグインを専用フォルダ限定で取り込む**。完了後、画面の案内にしたがって:
   1. `cd "~/<@より前>-agent"` で専用フォルダへ移動し `claude` を起動
   2. 起動した Claude で `/workflow-setup` を実行（プロフィール登録と 4 アプリの「許可」へ進む）
   - `claude` が見つからない場合は、**公式インストーラーで Claude Code CLI を自動導入**し（macOS は Homebrew / 公式ネイティブを選択可、それ以外は公式ネイティブ → npm）、`~/.local/bin` を PATH に通す。導入後は PATH を反映するため **ターミナルを一度閉じて開き直し（＝再起動）**、インストーラーを再実行するか専用フォルダを開く。自動導入に失敗したときだけ、設定ファイルを宣言的に書いて手動導入コマンドを案内する。

オプション: `--no-claude`（claude を使わず設定ファイルだけ書く）/ `--no-git`（git の確認・自動導入をスキップ。検証用）/ `--dry-run`（実行予定だけ表示）。

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
