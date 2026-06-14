@echo off
rem
rem BELTA workflow agent - Windows ダブルクリック・ランチャー
rem
rem このファイルと同じフォルダにある bootstrap.js を Node.js で実行するだけの薄いラッパー。
rem 実ロジックは bootstrap.js（Node 単一実装。cross-platform.md 準拠）に集約している。
rem エクスプローラーからダブルクリックするとコマンドプロンプトで起動する。
rem
setlocal
chcp 65001 >nul
set "DIR=%~dp0"
set "NODE="

where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE=node"
) else (
  if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
  if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
)

if not "%NODE%"=="" goto run_bootstrap

rem ---- Node.js 不在: winget で自動導入を試み、ダメならダウンロードページを開く ----
rem （括弧ブロック内の %errorlevel% は展開タイミングの罠があるため goto で分岐する）
echo Node.js が見つかりませんでした。インストーラーの実行には Node.js が必要です。
echo.
where winget >nul 2>nul
if errorlevel 1 goto node_manual
echo winget で Node.js LTS を自動インストールします（数分かかります）...
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto node_manual
echo.
echo Node.js をインストールしました。
echo この画面を閉じて、インストーラーをもう一度ダブルクリックしてください。
echo （新しい画面でないと、いま入れた Node.js が見つからないためです）
echo.
pause
exit /b 0

:node_manual
echo ブラウザで Node.js のダウンロードページを開きます。
echo 「LTS（推奨版）」をインストールしたあと、このインストーラーを
echo もう一度ダブルクリックしてください。
start "" "https://nodejs.org/ja/"
echo.
pause
exit /b 1

:run_bootstrap
"%NODE%" "%DIR%bootstrap.js" %*
echo.
pause
endlocal
