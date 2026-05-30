---
layout: home

hero:
  name: Belta ワークフローエージェント
  text: 話しかけるだけで、4 ツールに自動で振り分け
  tagline: Notion / Slack / GitHub / Google Drive を意識せず、使うほどあなた専用にチューニングされる社内エージェント（Claude Code Plugin）
  actions:
    - theme: brand
      text: 導入手順を見る
      link: /guide/getting-started
    - theme: alt
      text: 概要から読む
      link: /guide/
    - theme: alt
      text: 困ったときは（FAQ）
      link: /guide/faq

features:
  - icon: 🗣️
    title: ツールを意識しない
    details: 「来週の MTG メモを整理して」「インフラチームに共有して」――発話の内容から Notion / Slack / GitHub / Google Drive へ自動で振り分けます。
  - icon: 🔐
    title: 認証はすべて OAuth
    details: PAT や API キーの手動コピペは不要。Notion / Slack / Google Drive は claude.ai Connector、GitHub は gh CLI の OAuth で接続します。
  - icon: 🧠
    title: 使うほどパーソナライズ
    details: 繰り返す指示はルールに、繰り返す業務領域は専用エージェントに、足りない能力はスキル提案に。承認したものだけが蓄積されます。
  - icon: 🛡️
    title: 機密情報を外に出さない
    details: 外部送信の直前に PII / 機密ラベルを検知してブロック。permission allowlist と gitleaks を合わせた多層防御で守ります。
  - icon: 🖥️
    title: Mac / Windows 両対応
    details: フックや補助スクリプトは Claude Code 同梱の Node.js で実装。OS 依存コマンドに頼らず、どちらの環境でも同じように動きます。
  - icon: ⏱️
    title: 5 分で立ち上がる
    details: インストール後の初回セッションでセットアップを自動案内。氏名・部署・機密度の収集と 4 ツール接続まで約 5 分で完了します。
---

## このサイトについて

このサイトは **Belta ワークフローエージェント**（社内向け Claude Code Plugin）の **利用者向けガイド**です。インストールから初回セットアップ、日々の使い方、セキュリティ上の注意点までをまとめています。

初めての方は **[概要](/guide/)** → **[導入手順](/guide/getting-started)** の順に読み進めてください。

::: warning 取り扱い注意
本ガイドおよびプラグインが扱う情報には**社外秘**が含まれます。リンクの共有範囲・公開設定にご注意ください。個人データ（`~/.belta/` 配下）はリポジトリにコミットしないでください。
:::
