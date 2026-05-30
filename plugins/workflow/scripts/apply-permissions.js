#!/usr/bin/env node
//
// Belta workflow plugin — permission allowlist 適用フォールバック（Day 7）
//
// 同梱の権威ソース `<plugin>/.claude/settings.json` の permissions（allow/ask/deny）を、
// 利用者の settings.json へ冪等マージする。プラグイン同梱 settings のマージが
// 効かない環境向けの保険。/workflow-setup の最終ステップから呼ぶ。
//
// 使い方:
//   node scripts/apply-permissions.js [--target <settings.json のパス>] [--dry-run]
//
//   --target 省略時は <home>/.claude/settings.json（POSIX: $HOME / Windows: %USERPROFILE%）。
//   --dry-run 指定時は書き込まず差分のみ表示。
//
// 設計（クロスプラットフォーム規約）:
//   - シェル非依存の Node.js のみ（grep/sed/touch/chmod に依存しない）。
//   - パスは path API で連結（区切り直書きしない）。ホームは環境変数から解決。
//   - 冪等: 既存の同一エントリは重複追加しない。permissions 以外のキーは保持。
//   - 破壊回避: 既存 settings を読み、配列の和集合のみ反映（既存ルールを削除しない）。

const fs = require("fs");
const path = require("path");
const os = require("os");

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let targetPath = null;
let dryRun = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--target") targetPath = argv[++i];
  else if (argv[i] === "--dry-run") dryRun = true;
}

// ---- ホーム / プラグインルート解決 -------------------------------------------
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

// CLAUDE_PLUGIN_ROOT（フック実行時に設定される）優先。無ければこのファイルの 1 つ上。
function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, "..");
}

if (!targetPath) {
  targetPath = path.join(homeDir(), ".claude", "settings.json");
}

const sourcePath = path.join(pluginRoot(), ".claude", "settings.json");

// ---- 読み込み ----------------------------------------------------------------
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const source = readJson(sourcePath);
if (!source || !source.permissions) {
  console.error(`[apply-permissions] 権威ソースが読めません: ${sourcePath}`);
  process.exit(1);
}

const target = readJson(targetPath) || {};
if (typeof target !== "object" || Array.isArray(target)) {
  console.error(`[apply-permissions] 既存 settings の形式が不正です: ${targetPath}`);
  process.exit(1);
}

// ---- マージ（和集合・重複排除） ----------------------------------------------
target.permissions = target.permissions || {};
const buckets = ["allow", "ask", "deny"];
const added = { allow: [], ask: [], deny: [] };

for (const bucket of buckets) {
  const existing = Array.isArray(target.permissions[bucket]) ? target.permissions[bucket] : [];
  const incoming = Array.isArray(source.permissions[bucket]) ? source.permissions[bucket] : [];
  const seen = new Set(existing);
  const merged = existing.slice();
  for (const rule of incoming) {
    if (!seen.has(rule)) {
      seen.add(rule);
      merged.push(rule);
      added[bucket].push(rule);
    }
  }
  target.permissions[bucket] = merged;
}

const totalAdded = added.allow.length + added.ask.length + added.deny.length;

// ---- 出力 --------------------------------------------------------------------
if (dryRun) {
  console.log(`[apply-permissions] dry-run: ${targetPath}`);
  for (const bucket of buckets) {
    if (added[bucket].length) {
      console.log(`  + ${bucket}: ${added[bucket].length} 件追加予定`);
      for (const r of added[bucket]) console.log(`      ${r}`);
    }
  }
  if (totalAdded === 0) console.log("  追加なし（既に最新）");
  process.exit(0);
}

if (totalAdded === 0) {
  console.log(`[apply-permissions] 既に適用済み（変更なし）: ${targetPath}`);
  process.exit(0);
}

// 親ディレクトリを作成（recursive。Write 相当を fs で）
fs.mkdirSync(path.dirname(targetPath), { recursive: true });

// atomic write: 一時ファイルに書いて rename
const tmpPath = targetPath + ".tmp";
fs.writeFileSync(tmpPath, JSON.stringify(target, null, 2) + "\n", "utf8");
fs.renameSync(tmpPath, targetPath);

console.log(`[apply-permissions] 適用完了: ${targetPath}`);
for (const bucket of buckets) {
  if (added[bucket].length) console.log(`  + ${bucket}: ${added[bucket].length} 件追加`);
}
