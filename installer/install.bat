@echo off
rem
rem Belta workflow agent - Windows ダブルクリック・ランチャー
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

if "%NODE%"=="" (
  echo Node.js が見つかりませんでした。
  echo https://nodejs.org から Node.js を導入するか、次を実行してください:
  echo   node "%DIR%bootstrap.js"
  echo.
  pause
  exit /b 1
)

"%NODE%" "%DIR%bootstrap.js" %*
echo.
pause
endlocal
