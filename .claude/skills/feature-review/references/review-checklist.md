# レビュー観点チェックリスト（feature-review）

`diff-scan.js` の決定的シグナルを一次証拠に、ここに挙げた観点で差分を診断する。**シグナルはあくまで「候補」**であり、最終判定は該当ファイルを Read して裏取りしてから行う（grep の誤検知を鵜呑みにしない）。観点を勝手に減らさないこと。

根拠規約: [cross-platform.md](../../../rules/cross-platform.md) / [skill-writing.md](../../../rules/skill-writing.md) / [doc-writing.md](../../../rules/doc-writing.md) / [design.md](../../../rules/design.md) / [CLAUDE.md](../../../../CLAUDE.md)「セキュリティ層」。

重大度の目安:
- 🔴 **要修正** — 規約違反が確定／権限境界の拡大／PII 検知の同期漏れ／`node --check` NG。コミット前に直す。
- 🟡 **要確認** — 候補シグナルあり。設計意図次第で許容も。理由を添えて確認を促す。
- 🟢 **提案** — 動くが、より規約に沿う書き方・テスト追加の提案。

---

## ① セキュリティ面（CLAUDE.md「セキュリティ層」4層）

- [ ] **PII 検知の3層同期** — `hooks/pre-tool-use.js` の検知パターン（マイナンバー/CC Luhn/メール一括/機密ラベル/パスワード）を変更したら、`.gitleaks.toml`（Git 層）と整合しているか。`signals.pii_sync` が立っていたら 🔴 同期漏れを疑い、両ファイルを Read して確認。
- [ ] **権限境界の拡大** — `plugins/workflow/.claude/settings.json` の `permissions` が**唯一の権威ソース**。`signals.permissions` に挙がったエントリが `allow`（無確認実行）に追加されていないか。読み取り系以外を allow に入れるのは 🔴。`deny`（`rm -rf`/`sudo`/`git push --force` 等）を緩めていないか。`plugin.json` に permissions を生やしていないか（マニフェストの機能ではない）。
- [ ] **機密データの配置** — 個人/機密データ（profile・notes・audit・config・rules・goals・inbox・todos）は `~/.belta/` か `<agent_home>/.claude/agents|skills`。これらをリポジトリに含めたり、別の場所へ書く変更は 🔴。`~/.belta/` 配下が `.gitignore` で守られているか。
- [ ] **認証** — OAuth ベースを維持しているか。PAT / API キー / パスワードの平文保存・ハードコードを足していないか（GitHub のみ `gh` CLI 経由）。
- [ ] **外部送信** — 新たに Slack/Notion/GDrive/curl 等の外部送信経路を足したら、`hooks.json` の PreToolUse matcher に乗り、`settings.json` で `ask` になるか（PII 検知フックが発火する前提か）。

## ② テスト網羅性（このプラグインに従来型テストランナーは無い）

- [ ] **構文** — 追加/変更した `.js` すべてが `node --check` を通るか。`node_check` に `ok:false` があれば 🔴。
- [ ] **フックの手動実行想定** — フック変更時、stdin にダミーペイロードを流す手動確認（`echo '{...}' | node hooks/xxx.js`）が成り立つ入出力か。
- [ ] **合成シナリオ（cross-platform.md §8）** — OS 依存処理を足したら、両 OS 分岐（symlink 成功/EPERM フォールバック・`%USERPROFILE%`）・ファイル有無・異常入力・空入力の最低限のシナリオが担保されているか。「正常系しか考えていない」差分は 🟡。
- [ ] **fail-open** — 新規 `.js`(hook/script) に例外時の安全側退避（try/catch・`process.exit(0)`・無出力）があるか。`signals.failopen` が立っていたら 🟡（フックがセッションを妨げる危険）。
- [ ] **回帰** — 既存の決定的シグナル元（`repeat-util.js`/`goal-util.js`/`tokens-util.js` 等の共通パーサ）を変更したら、それを再利用する全スクリプトへの影響を確認したか。

## ③ 単一責任の原則（skill-writing.md §1, §5）

- [ ] **1スキル1役割** — 追加スキルが [9カテゴリー](../../../rules/skill-writing.md)（①API参照/②検証/③データ分析/④業務自動化/⑤コード生成/⑥品質レビュー/⑦CI-CD/⑧ランブック/⑨インフラ運用）のいずれか **1つ**に明確に収まるか。複数にまたがるなら分割（🟡）。
- [ ] **description は AI 向けに狭く具体的** — 発火トリガー語が具体的で、無関係な場面で誤発火しない狭さか。SKIP/非適用条件があるか。広すぎる description は誤発火＋トークン浪費（🟡）。`features` に挙がった新規スキル/コマンドの description をこの観点で点検。
- [ ] **新規フックの正当性** — `signals.new_hooks` が立っていたら、既存フック内のリファクタで済まないか、本当に新しいイベント責務かを確認。安易な追加は 🟡（フックは増やさない方針）。
- [ ] **肥大化の分割** — 1つのフック/スクリプト/スキルに役割が増えていないか。段階的開示（SKILL.md 入口 + references/ + scripts/）で外出しすべき詳細が本文に詰め込まれていないか。

## ④ クロスプラットフォーム ＋ ドキュメント整合

**クロスプラットフォーム（cross-platform.md）:**
- [ ] **禁止コマンド非混入** — 必須経路に `mkdir -p`/`cp`/`ln -s`/`touch`/`rm -rf`/`chmod`/`cat`/`sed`/`awk` を置いていないか。`signals.cross_platform` を一次証拠に、該当行を Read して「実コードか・コメント/文字列か」を判別（コメントや正規表現定義での誤検知は除外して報告）。実コードなら 🔴、`fs` API/標準ツールへ。
- [ ] **パス・ホーム解決** — `os.homedir()`／`process.env.HOME || USERPROFILE`／`path.join()` を使い、`~/` やパス区切りを直書きしていないか。
- [ ] **改行** — `split("\r\n")` 固定でなく `/\r?\n/` で両対応か。BOM を付けていないか。
- [ ] **symlink フォールバック** — symlink を使うなら EPERM 等でコピーへフォールバックし、配置モードを返しているか。
- [ ] **機密性を権限ビットに依存させない** — `chmod 0600` を唯一の防御にしていないか。

**ドキュメント整合（doc-writing.md）:**
- [ ] **アンカー非破壊** — `signals.docs_anchors` が立っていたら 🔴 候補。`docs/` の `##`/`###` 見出し文言を変えると他ページの内部リンク（`#...`）が切れる。変えたなら参照側を全て追従したか。`npm run docs:build` で dead-link が出ないか。
- [ ] **frontmatter 非破壊** — `---` で囲う frontmatter を壊していないか。
- [ ] **非エンジニア可読性** — 利用者向け `docs/` を足したら、結論先出し・専門用語の「日常語（専門用語）」翻訳・1セクション1メッセージになっているか。

## ⑤ BELTA 固有規約

- [ ] **fail-open 徹底** — フックは例外時に必ずセッションを妨げない（`exit 0` + 無出力）。プロンプトをブロックしない（UserPromptSubmit 系）。
- [ ] **決定的層 / LLM 層の役割分担** — 決定的な走査・cron 生成・集計は Node スクリプト、意味判断・要約・ファイル更新は LLM スキル、の二層構造を崩していないか。スクリプトが意味判断を始めていないか、スキルが `cat`/`grep` で決定的走査を肩代わりしていないか。
- [ ] **索引ファイルの整合** — subagent/skill を生成する変更なら、索引（`~/.belta/agents/AGENTS.md`・`~/.belta/skills/AUTHORED.md`・`SKILLS.md`）の更新指示が伴っているか。生成物の実体は `<agent_home>/.claude/agents|skills` へ Write する方針か。
- [ ] **version 2ファイル同期** — `signals.version_sync` が立っていたら 🔴。`plugin.json` と `marketplace.json` の `version` は同値で揃える。
- [ ] **ブランド表記** — 散文（README・docs・コメント・description・コミットメッセージ）でブランドを指すとき全大文字「BELTA」か（「Belta」「belta」は不可）。ただし識別子・パス・固有名（`belta-workflow-agent`/`~/.belta/`/`belta.co.jp`/`belta-group`/`listBeltaJobs` 等）は原表記のまま。
- [ ] **デザイントンマナ（design.md）** — 見た目を持つ生成物（HTML ダッシュボード・SVG）を変更したら、EC-BELTA トンマナ（Primary `#d76492`・文字は `#c44d7d`・淡ピンク面・角丸・弱い影・Noto Sans JP・外部 Web フォント不読込）に沿っているか。グレー面・直角の箱・出自不明の色を増やしていないか。
