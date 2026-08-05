# managed-settings.json — 組織全体へ強制するガバナンス設定

`managed-settings.json` は、**利用者が自分で外せない**セキュリティ設定を組織全体へ配るためのテンプレート。プラグインが配送する `settings.local.json` は利用者が編集・削除できるが、こちらは設定階層の最上位でユーザー／プロジェクト設定から上書きできない。

## 配布方法は 2 系統（同じ JSON をそのまま使える）

| 方式 | 対象 | 手順 |
| --- | --- | --- |
| **サーバー管理設定**（推奨・MDM 不要） | Claude for Teams / Enterprise プラン | 組織の Owner または Primary Owner が [claude.ai の Admin Settings > Claude Code > Managed settings](https://claude.ai/admin-settings/claude-code) に本ファイルの中身を貼って保存。組織 OAuth でログインした全クライアントが起動時＋1 時間ごとに取得する |
| **エンドポイント管理設定**（MDM 導入後） | プラン不問 | MDM（Jamf / Intune）または手動で所定パスへ配置。macOS `/Library/Application Support/ClaudeCode/managed-settings.json` / Windows `C:\Program Files\ClaudeCode\managed-settings.json` / Linux `/etc/claude-code/managed-settings.json` |

BELTA は Team プラン・MDM 未導入のため**サーバー管理設定が本命**。将来 MDM を導入したら、OS レベルでファイルを保護できるエンドポイント管理設定へ移すと強制力が上がる。

適用されたかの確認は、利用者に Claude Code を再起動してもらい `/permissions` で管理ルールが見えることと、`/status` でどの管理ソースが有効かを見る。

## 使う前に必ず置換するもの

- `forceLoginOrgUUID` の `REPLACE_WITH_BELTA_ORG_UUID` — claude.ai の管理画面で確認した組織 UUID に置き換える。**置換しないと誰もログインできなくなる。**
- `allowedMcpServers` のサーバ名 — MCP サーバ名は環境依存で UUID になることがある。利用者に `/mcp` で実名を確認してもらい一致させる。**ホワイトリストなので名前がずれるとその MCP が全て使えなくなる。**

## 設計判断（読まずに編集すると壊れる箇所）

- **`allowManagedPermissionRulesOnly: true` を入れているため、allow / ask も全量ここに載せている。** managed のルールだけが有効になる仕様なので、deny だけ載せると読み取り系や MCP 読み取りの allow が全部無効化され、毎回確認ダイアログが出る状態になる。**この結果、権限を変えるときは権威ソース `plugins/workflow/.claude/settings.json` と本ファイルの 2 箇所を同期する必要がある。**
- **`allowManagedHooksOnly` はあえて入れていない。** 有効化すると managed の `enabledPlugins` で強制有効にしたプラグインのフックしか読まれず、本プラグインのフック（PII 検知・skill-gate）が止まる。回避には managed で `enabledPlugins` を配ることになるが、それは全ディレクトリ発火＝ローカルスコープ限定運用の大原則と衝突する。代わりに `disableAllHooks: false` を managed から配信して、利用者が `true` にしてフック層を丸ごと無効化する経路を塞ぐ。
- **`$comment` キーを入れない。** サーバー管理設定はスキーマ検証に失敗したエントリを削除して利用者に検証エラーを表示するため、権威ソースで使っているコメント慣行は持ち込まない（この README がその代替）。
- **`.env` などの deny は `//` 絶対アンカー形に寄せている。** 管理設定内の相対パターンは配信元基準で解決され意図とずれる（公式の「ユーザー設定に書いた `/secrets/**` は `~/.claude/secrets/**` になる」問題と同種）。
- **`requiredMinimumVersion: "2.1.208"`** は「Read deny が Edit ツールも塞ぐ」挙動が入ったバージョンに合わせた床。
- **`forceRemoteSettingsRefresh` は入れていない。** 有効にすると `api.anthropic.com` に到達できないとき Claude Code が起動せず終了する。ネットワーク経路が安定してから検討する。
- **`availableModels` / `enforceAvailableModels` は入れていない。** モデルティアの運用は `skills/workflow/references/model-tiers.md` を SSOT としているため、ここに書くと二重管理になる。統制を強めたくなったら追加する。
- **`strictPluginOnlyCustomization` は採用しない。** `agent-learning` / `skill-authoring` が `<agent_home>/.claude/agents`・`.claude/skills` へ生成物を置く仕組みと正面衝突する。
- **`disableClaudeAiConnectors` は採用しない。** Notion / Slack / Google Drive 連携は本プラグインの中核機能。

## 限界（過信しないための注意）

サーバー管理設定は**クライアント側の制御であり、セキュリティ境界ではない**。管理されていないデバイスでは、キャッシュ改ざん（次回フェッチで復元される）、古いバージョンの利用、サードパーティモデルプロバイダー（Bedrock / Vertex 等）の設定によるバイパスが成立しうる。厳格な強制が必要なら MDM 登録済みデバイスへのエンドポイント管理設定を使う。

ランタイムの設定変更は `hooks/config-change.js`（ConfigChange フック）が `~/.belta/audit/security/` に記録している。
