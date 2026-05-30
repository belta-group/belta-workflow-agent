# クロスプラットフォーム実装規約（Mac / Windows 両対応）

このプラグインの実装物（フック・スクリプト・スキルが指示する操作）は、**macOS と Windows のどちらでも同じように動く**ことを必須要件とする。利用者は両 OS に分布する。OS 依存の挙動に頼った実装は、片方の環境で黙って壊れるため禁止する。

## 1. 実行系は Node.js に寄せる

OS 自動化が必要な処理は **Claude Code 同梱の Node.js ランタイム**で実装する。`bash` / `.sh` / `.ps1` / `.bat` の二重メンテはしない。

- フック・補助スクリプトは `#!/usr/bin/env node` の Node.js 単一実装にする（例: `hooks/session-start.js`, `hooks/pre-tool-use.js`, `scripts/*.js`）。
- スキル（SKILL.md）が利用者環境で何かを生成・配置するときは、OS 依存コマンドを必須経路に置かず、**Claude Code 標準ツール**（Write / Read 等）か **同梱 Node.js ヘルパー**に委ねる。

## 2. パス・ホームディレクトリの解決

- ホームディレクトリは `os.homedir()` で解決する。シェルの `~` 展開に依存しない。SKILL.md 内の指示でも「POSIX: `$HOME` / Windows: `%USERPROFILE%` から解決」と明記し、`~/...` を必須経路の文字列に直書きしない。
- パス連結は `path.join()` に委ね、区切り文字（`/` ・ `\`）を直書きしない。
- 文字列のエスケープ・改行は `JSON.stringify` 等の標準機構に委ね、手書きしない。

## 3. POSIX シェルコマンドを必須経路に置かない

次のような OS 依存コマンドは Windows で動かない／挙動が違うため、**必須の処理経路**に使わない。Node.js の `fs` API か Claude Code 標準ツールで代替する。

| 避ける | 代替 |
| --- | --- |
| `mkdir -p` | `fs.mkdirSync(dir, { recursive: true })` / Write ツール（親ディレクトリ自動作成） |
| `touch` | Write ツールで空ファイル作成 / `fs.writeFileSync` |
| `cp` / `copy` | `fs.copyFileSync` |
| `ln -s` | `fs.symlinkSync(src, dst, "file")`（失敗時はコピーへフォールバック、後述 §4） |
| `rm -rf` | `fs.rmSync(path, { force: true })`（対象を限定して） |
| `cat` / `sed` / `awk` で読み書き | Read / Edit / Write ツール、`fs` API |
| `chmod` / `chown` | §5 を参照（権限に機密性を依存させない） |

## 4. symlink は「不可ならコピー」へフォールバック

Windows ではファイル symlink に管理者権限または開発者モードが要る。symlink を第一候補にしつつ、`EPERM` 等で失敗したら**コピーにフォールバック**し、どちらのモードで配置したかを呼び出し側へ返す（例: `skills/agent-learning/scripts/link-agent.js`）。コピー時は「正本更新が自動反映されない」旨を記録する。

## 5. ファイル機密性を権限ビットに依存させない

`chmod 0600` は Windows では実効性がない。トークン・認証情報の機密性は **ファイル権限ではなく** OS 標準資格情報ストア（macOS keychain / Windows 資格情報マネージャー）や claude.ai 側 OAuth 保管庫で守る。`fs.writeFileSync(..., { mode: 0o600 })` を付けるのは構わないが、それを唯一の防御にしない。

## 6. 改行・エンコーディング

- テキストファイルは UTF-8。BOM を付けない。
- 改行コードに依存する解析（`split("\r\n")` 固定等）をしない。`/\r?\n/` のように両対応で処理する。`.gitattributes` で改行を正規化する場合もコード側で前提にしない。

## 7. 例外時も安全側に倒す

フックは失敗しても本来のツール実行・セッションを妨げない設計にする（例: 集計フックは例外時も無出力で `exit 0`）。OS 差異で想定外の値が来ても落とさず、JSON で状態を返して呼び出し側に判断させる。

## 8. 検証

OS 依存の処理を書いたら、合成シナリオで両 OS の分岐（symlink 成功／コピーフォールバック、ファイル有無、異常入力）を最低限テストする。少なくとも macOS 上で `node --check` と主要パスの実行確認を行い、Windows 固有分岐（symlink 不可・`%USERPROFILE%`）はコードレビューで担保する。
