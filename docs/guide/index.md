# 概要

**Belta ワークフローエージェント**は、Belta 社内向けのワークフロー自動化エージェント（Claude Code Plugin）です。`/workflow` を起点に、利用者ひとりひとりの部署・主要業務・機密度を把握し、以降の発話を **Notion / Slack / GitHub / Google Drive** の最適なツールへ自動で振り分けます。

利用者はツールの違いを意識する必要がありません。窓口はこのエージェントひとつです。

## 何ができるか

- **発話 → ツール自動分岐** — 「議事録を整理して」なら Notion、「チームに共有して」なら Slack、「先週の PR をまとめて」なら GitHub、「資料 PDF を取り込んで」なら Google Drive、と内容から判断します。
- **複数ツールにまたがる依頼** — 「議事録を Notion にまとめてチームに Slack 共有」のような依頼も、順序立てて 1 つずつ実行します。
- **使うほどパーソナライズ** — 繰り返す指示・業務領域・不足している能力を検知し、**承認を取ったうえで**ルール・専用エージェント・追加スキルとして蓄積します。
- **Notion DB 設計支援** — 自部署の Notion スキーマ設計を、設計知識を持つサブスキルが支援します。

## 対象利用者

- Belta の社員（情報システム部を中心に、Phase -1 では情シス 2〜3 名で社内試用中）。
- Claude Code を業務で使う方。エンジニアでなくても、`gh auth login --web` の 1 コマンドと claude.ai のブラウザ認可ができれば利用できます。

::: tip Phase -1（社内試用）
本プラグインは現在 Phase -1（社内試用）です。情シス数名で動作確認し、経営承認会議向けの実測データを取得する段階です。機能・ドキュメントは随時更新されます。
:::

## 前提環境

| 項目 | 要件 |
| --- | --- |
| Claude Code | インストール済み（CLI / デスクトップ / IDE 拡張のいずれか） |
| claude.ai プラン | **Max / Team / Enterprise** のいずれか（Connector 利用に必要） |
| `gh` CLI | GitHub を使う場合に必要（macOS: `brew install gh` / Windows: `winget install GitHub.cli`） |
| OS | macOS / Windows のどちらも対応 |
| ネットワーク | claude.ai・github.com への到達性（社内プロキシ下では情シスに確認） |

## 全体像

```
あなたの発話
   │
   ▼
/workflow（窓口エージェント）
   │  内容・キーワード・機密度から判断
   ├─▶ Notion        … メモ / 議事録 / TODO / DB 設計
   ├─▶ Slack         … 共有 / 連絡 / 通知 / リマインド
   ├─▶ GitHub        … PR / Issue / リリース / CI 状況
   └─▶ Google Drive  … ファイル検索 / PDF・資料の取り込み
   │
   ├─ PII 検知フック（外部送信の直前にブロック）
   ├─ permission allowlist（allow / ask / deny）
   └─ パーソナライズ（ルール / 専用エージェント / スキル提案）
```

## 次のステップ

- **[導入手順（5 分セットアップ）](/guide/getting-started)** — インストールから初回セットアップまで。
- **[4 ツール OAuth 接続](/guide/oauth-setup)** — Notion / Slack / Google Drive / GitHub の接続方法。
- **[基本的な使い方](/guide/usage)** — 日々の発話例とツール分岐のイメージ。
