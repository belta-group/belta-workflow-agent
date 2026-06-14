#!/bin/bash
#
# BELTA workflow agent — macOS ダブルクリック・ランチャー
#
# このファイルと同じフォルダにある bootstrap.js を Node.js で実行するだけの薄いラッパー。
# 実ロジックは bootstrap.js（Node 単一実装。cross-platform.md 準拠）に集約している。
# Finder からダブルクリックすると Terminal で起動する。
#
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"

find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return; fi
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node"; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
  if [ -d "$HOME/.nvm/versions/node" ]; then
    latest="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
    if [ -n "$latest" ] && [ -x "$HOME/.nvm/versions/node/$latest/bin/node" ]; then
      echo "$HOME/.nvm/versions/node/$latest/bin/node"; return
    fi
  fi
  echo ""
}

NODE="$(find_node)"
if [ -z "$NODE" ]; then
  echo "Node.js が見つかりませんでした。インストーラーの実行には Node.js が必要です。"
  echo
  # Homebrew があれば、その場で自動インストールを提案する。
  if command -v brew >/dev/null 2>&1; then
    printf "Homebrew で Node.js をインストールしますか？（数分かかります） [Y/n]: "
    read -r ans
    case "$ans" in
      [nN]*) ;;
      *)
        if brew install node; then
          NODE="$(find_node)"
          [ -n "$NODE" ] && echo "Node.js をインストールしました。インストーラーを続行します。"
        else
          echo "Homebrew でのインストールに失敗しました。"
        fi
        ;;
    esac
  fi
  # それでも無ければ、ダウンロードページを開いて再実行を案内する。
  if [ -z "$NODE" ]; then
    echo
    echo "ブラウザで Node.js のダウンロードページを開きます。"
    echo "「LTS（推奨版）」をインストールしたあと、このインストーラーを"
    echo "もう一度ダブルクリックしてください。"
    open "https://nodejs.org/ja/" 2>/dev/null || echo "  → https://nodejs.org/ja/ を開いてください"
    echo
    read -n 1 -s -r -p "何かキーを押すと閉じます..."
    echo
    exit 1
  fi
fi

"$NODE" "$DIR/bootstrap.js" "$@"
STATUS=$?
echo
read -n 1 -s -r -p "何かキーを押すと閉じます..."
echo
exit $STATUS
