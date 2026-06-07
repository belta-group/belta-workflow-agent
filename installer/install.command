#!/bin/bash
#
# Belta workflow agent — macOS ダブルクリック・ランチャー
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
  echo "Node.js が見つかりませんでした。"
  echo "https://nodejs.org から Node.js を導入するか、ターミナルで次を実行してください:"
  echo "  node \"$DIR/bootstrap.js\""
  echo
  read -n 1 -s -r -p "何かキーを押すと閉じます..."
  echo
  exit 1
fi

"$NODE" "$DIR/bootstrap.js" "$@"
STATUS=$?
echo
read -n 1 -s -r -p "何かキーを押すと閉じます..."
echo
exit $STATUS
