#!/usr/bin/env node
//
// Belta workflow plugin — 初回セットアップ自動起動フック（SessionStart）
//
// Claude Code には「インストール時フック」が存在しないため、インストール後
// 最初のセッション開始時にこのフックが発火し、オンボーディング未完了であれば
// エージェントへ「初回セットアップを開始せよ」という追加コンテキストを注入する。
//
// 一度きり（once-only）の判定は ~/.belta/.onboarded の有無で行う。
// このファイルは /workflow-setup 完了時に作成される。未完了のうちは
// 毎回のセッション開始時に再度案内する（= やり残しの自己修復）。
//
// Mac / Windows 両対応のためシェル非依存の Node.js で実装する
// （Claude Code 同梱の node ランタイムで動作。bash / .ps1 の二重メンテ不要）。
// ホームディレクトリ解決は os.homedir()、パス連結は path.join、
// JSON 文字列のエスケープは JSON.stringify に委ねる（区切り文字・改行を直書きしない）。

const fs = require("fs");
const os = require("os");
const path = require("path");

const stateFile = path.join(os.homedir(), ".belta", ".onboarded");

// 既にオンボーディング済みなら何もしない（追加コンテキストを注入しない）
if (fs.existsSync(stateFile)) {
  process.exit(0);
}

const context = [
  "【Belta ワークフローエージェント 初回セットアップ】",
  "",
  "この環境ではまだ初回セットアップ（~/.belta/.onboarded）が完了していません。ユーザーへの応答の冒頭で、これからセットアップを行う旨を一言伝えたうえで、/workflow-setup コマンドの手順（plugins/workflow/commands/workflow-setup.md）に従い、初回オンボーディングを開始してください。",
  "",
  "収集する項目: 氏名 / 部署 / 主要業務（3つまで） / 扱う情報の機密度（公開・社外秘・極秘） / 接続する MCP ツール（Notion・Slack・Google Drive・GitHub）。",
  "",
  "メールアドレスは userEmail コンテキスト（system-bot@belta.co.jp 等）を初期値として確認し、必要なら訂正してもらってください。収集後 ~/.belta/profile.md を生成し、4 ツールの OAuth 接続を案内し、完了したら ~/.belta/.onboarded を作成してください。",
  "",
  "ただしユーザーが別の用件を明確に依頼している場合は、その用件を優先し、セットアップは後回しでよい旨を伝えてください（セットアップは次回起動時に再度案内されます）。",
].join("\n");

const output = {
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: context,
  },
};

process.stdout.write(JSON.stringify(output) + "\n");
process.exit(0);
