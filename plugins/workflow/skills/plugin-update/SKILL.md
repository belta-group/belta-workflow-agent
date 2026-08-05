---
name: plugin-update
description: >
  この BELTA ワークフローエージェント（プラグイン）自身に新しいバージョンがあるかを確認し、
  承認を得て最新へ更新する。「アップデートして」「最新にして」「更新ある？」「新しいバージョン出てる？」
  「プラグインを更新して」「バージョン上げて」「最新版にして」といった発話、または /workflow-update で発火する。
  SKIP: 作者がリリースを作る作業（→ release スキル）、npm や OS など他のソフトウェアの更新、
  ゴールやタスクの「進捗を更新」といった別文脈の「更新」。
---

# プラグイン自己アップデート（plugin-update）

このエージェント自身を最新版に入れ替えるスキル。**利用者の手元を最新化する**役割で、作者がリリースを**作る** [release](../../../.claude/skills/release/SKILL.md) スキルとは別物。

> **なぜ専用スキルが必要か**: Claude Code の自動更新（`extraKnownMarketplaces.autoUpdate`）は既知バグで機能しない（後述の Gotchas）。放っておくと利用者の手元は古いまま残り、修正も新機能も届かない。だから「確実に効く手順」を 1 つのスキルに閉じ込める。

## いつ使うか

- 「アップデートして」「最新にして」「更新ある？」「新しいバージョン出てる？」等の発話
- `/workflow-update` コマンド
- `hooks/session-start.js` の (E) 更新通知（＝すでに更新が**適用済み**の通知）を見て、利用者が「他に更新は無いか」と尋ねたとき

**使わない場面**: エージェント以外のソフトウェア更新、リリース作成（`release` スキル）、ゴールやノートの「進捗更新」。

---

## フロー

### Step 1: 更新の確認（決定的・読み取り専用）

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/update-check.js"
```

返る JSON の要点：

| フィールド | 意味 |
| --- | --- |
| `ok` | 確認できたか（`false` なら `reason` と `message` を読む） |
| `installed` / `latest` | 手元のバージョン / リモート（GitHub）の最新バージョン |
| `update_available` | 更新があるか（`latest > installed` のときだけ true） |
| `agent_home` | 適用先の専用フォルダ（`--scope local` の実行場所） |
| `manual_commands` | 代行が失敗したときに利用者へ提示する 2 コマンド |

### Step 2: 結果に応じて分岐

- **`update_available: false`** → 「すでに最新です（v`<installed>`）」と 1 行で伝えて終了。余計な操作はしない。
- **`ok: false`** → `message` をそのまま噛み砕いて伝え、`manual_commands` を提示して終了。**ここで止まってよい**（ネットワーク不通や未認証はこちらで解決できない）。`reason` 別の言い換え：
  - `fetch_failed` — 「最新版の情報を取りに行けませんでした（ネットワークか GitHub の認証）。あとで試すか、`/plugin` メニューから確認できます」
  - `agent_home_unresolved` / `agent_home_missing` — 「更新の適用先（専用フォルダ）が分かりませんでした」＋ `/workflow-setup` の再実行案内
  - `marketplace_unresolved` / `repo_unresolved` — 配布物の構成が想定外。手動コマンドへ倒す
- **`update_available: true`** → Step 3 へ。

### Step 3: 承認を取る（サイレント更新はしない）

`AskUserQuestion` で確認する。**バージョンと、再起動が必要なことを必ず添える**：

> 「新しいバージョンがあります（v`<installed>` → v`<latest>`）。いま更新しますか？ 更新後は Claude Code を開き直す必要があります」

- 選択肢は「更新する」/「あとで」。
- 「あとで」なら何もせず終了（しつこく繰り返さない）。

### Step 4: 適用（承認後のみ）

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/update-check.js" --apply
```

これが 2 つのコマンドを順に代行する（それぞれ Claude Code の許可確認が出る）：

1. `claude plugin marketplace update <marketplace>` — 配布元のクローンとキャッシュを最新化
2. `claude plugin update <plugin>@<marketplace> --scope local` — 参照を新バージョンへ切替（**専用フォルダ内で実行**。スクリプトが作業フォルダを指定するので `cd` は不要）

### Step 5-a: 成功 → 再起動を案内

`ok: true` / `restart_required: true` のとき、次を必ず伝える：

> 「v`<latest>` に更新しました。**反映するには Claude Code を一度閉じて、専用フォルダ（`<agent_home>`）を開き直してください。** 開き直すと更新のお知らせが新しいバージョンを確認します」

あわせて、**生成済みの成果物は再生成するまで古いまま**であることを添える（該当するものだけ）：`/avatar`（ダッシュボード）・`/usage`（トークン消費）・`/report`。

### Step 5-b: 失敗 → 手動コマンドを提示

`ok: false` のときは `steps` の `error` を読み、`failed_step` に応じて案内する。**エラー本文をそのまま貼らず、意味を訳してから**手動コマンドをコードブロックで出す：

```
claude plugin marketplace update <marketplace>
claude plugin update <plugin>@<marketplace> --scope local
```

- `failed_step: "marketplace-update"` — 配布元の取得で失敗（ネットワーク・認証）。2 つ目だけ成功していれば更新は済んでいる可能性があるので `steps` を両方見る。
- `failed_step: "plugin-update"` — 参照の切替で失敗。**専用フォルダで実行できているか**（`cwd`）と `--scope local` が付いているかを確認する。

---

## 罠（Gotchas）— すべて実環境で踏んだもの

- 🔴 **自動更新（`autoUpdate: true`）は機能しない。** Claude Code の既知バグ（anthropics/claude-code#52218: `installed_plugins.json` が更新されない / #17361: marketplace キャッシュが refresh されない）。v0.5.3 の配布時に再実証済み（リリース後もクローンが v0.5.1 のままで `/plugin` 表示も 0.5.1）。**このスキルが存在する理由がこれ。** `scripts/apply-auto-update.js` は「バグが直ったら効く」先回り設定として残してあるが、今は当てにしない。
- 🔴 **`claude plugin install` は更新にならない。** 既にインストール済みだと「already installed」で何もしない（再インストールではない）。更新は必ず `plugin update`。
- 🔴 **`plugin update` は `--scope local` が必須。** 本プラグインはローカルスコープ運用（専用フォルダ限定）なので、既定の user スコープでは `not installed at scope user` で失敗する。あわせて**専用フォルダの中で実行する必要がある**（`update-check.js --apply` は execFileSync の `cwd` でこれを担保している。`cd A && B` はシェル依存なので使わない）。
- 🔴 **適用しても、再起動するまで古いバージョンが動き続ける。** いま話しているセッション自身が旧版なので、「更新したのに挙動が変わらない」は正常。必ず開き直しを案内する。
- **`session-start.js` の (E) 更新通知は「適用後」に出る。** 「更新が利用可能」ではなく「更新された」の通知なので、(E) が出ないことは「最新である」ことを意味しない。だから手動確認の入口（このスキル）が必要。
- **設定ディレクトリを複数持つ環境**（`CLAUDE_CONFIG_DIR` でプロファイルを分けている等）では、**プロファイルごとに更新が必要**。片方だけ新しくなって挙動が食い違う。
- **`gh` が未導入・未認証でも確認はできる。** `update-check.js` は `gh api` → `raw.githubusercontent.com` の 2 段フォールバックで最新バージョンを取る。両方失敗したら `fetch_failed` を返すだけで、セッションは妨げない（fail-open）。

---

## セキュリティ・クロスプラットフォーム

- 確認は**読み取りのみ**（GitHub 上の `marketplace.json` の `version` を見るだけ。認証情報も個人データも送らない）。
- 適用は `claude` CLI に委譲する。プラグインの実体を自前で書き換えたり、`git`・`cp`・`rm` でファイルを動かしたりしない（Claude Code の管理下から外れると復旧できなくなる）。
- 実行はすべて Node.js の `execFileSync`（引数配列渡し）。シェル経由の文字列結合をしないので、`cd` / `&&` / クォートの OS 差に依存しない（Mac / Windows 両対応。`cross-platform.md`）。
- `--apply` は Bash 経由なので、Claude Code の許可確認と `hooks/pre-tool-use.js` のやさしい説明がそのまま効く。**確認をスキップさせない。**

## ファイル参照

- 決定的エンジン（確認・適用）: `scripts/update-check.js`
- 入口コマンド: `/workflow-update`（`commands/workflow-update.md`）
- 更新後の通知（適用済みの検知）: `hooks/session-start.js` の (E)
- 自動更新の先回り設定（バグ修正後に効く）: `scripts/apply-auto-update.js`
- 作者側のリリース作業: `release` スキル（リポジトリの `.claude/skills/release/`）
