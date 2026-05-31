#!/usr/bin/env node
//
// Belta workflow plugin — marketplace auto-update の先回り有効化
//
// 利用者の settings.json の `extraKnownMarketplaces.<marketplace>` に
// `{ source: { source: "github", repo }, autoUpdate: true }` を冪等マージし、
// 「push（+ version up）したぶんが起動時に自動で届く」状態を初回オンボーディングで作る。
//
// 根拠（公式仕様）:
//   - settings.json の `extraKnownMarketplaces.<name>.autoUpdate`(boolean) が auto-update の
//     正規の保存先（TUI の Enable auto-update もここへ書く）。
//   - 公式ドキュメント: 管理者は managed settings の各 extraKnownMarketplaces エントリに
//     `autoUpdate: true` を設定することで、利用者にトグルさせず組織マーケットプレイスの
//     自動更新を有効化できる。本スクリプトはこれを利用者スコープで再現する。
//
// 使い方:
//   node scripts/apply-auto-update.js [--scope user|project|local] [--target <path>]
//                                     [--marketplace <name>] [--repo <owner/repo>]
//                                     [--ref <branch|tag>] [--dry-run]
//
//   適用先（settings.json）の決定は apply-permissions.js と同じ優先順:
//     1. --target <path>            … 明示パス（最優先）。
//     2. --scope user|project|local … 明示スコープ。
//     3. 自動判定（既定）           … プラグインが有効化されているスコープと同じ場所へ。
//   これにより権限と同じ settings.json に auto-update 設定も集約される。
//
//   marketplace 名と GitHub repo は、配布物の marketplace.json（pluginRoot から上位へ探索）
//   から自動取得する。見つからない／上書きしたい場合は --marketplace / --repo で渡す。
//
// 注意（CLAUDE.md との整合）:
//   - 権限境界の単一権威ソースは settings.json の `permissions` であり、本スクリプトは
//     それには一切触れない（`extraKnownMarketplaces` のみ追記）。権限変更ではない。
//
// 設計（クロスプラットフォーム規約）:
//   - シェル非依存の Node.js のみ（grep/sed/touch/chmod に依存しない）。
//   - パスは path API で連結。ホームは環境変数から解決。改行は /\r?\n/ 両対応で扱わない
//     （JSON 入出力のみ。JSON.stringify に委ねる）。
//   - 冪等: 既に autoUpdate:true なら変更なし。既存の他フィールド・他マーケットプレイスは保持。

const fs = require("fs");
const path = require("path");
const os = require("os");

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let targetPath = null;
let scope = null;
let dryRun = false;
let marketplaceOverride = null;
let repoOverride = null;
let refOverride = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--target") targetPath = argv[++i];
  else if (argv[i] === "--scope") scope = argv[++i];
  else if (argv[i] === "--marketplace") marketplaceOverride = argv[++i];
  else if (argv[i] === "--repo") repoOverride = argv[++i];
  else if (argv[i] === "--ref") refOverride = argv[++i];
  else if (argv[i] === "--dry-run") dryRun = true;
}

if (scope && !["user", "project", "local"].includes(scope)) {
  console.error(`[apply-auto-update] --scope は user / project / local のいずれか: ${scope}`);
  process.exit(1);
}

// ---- ホーム / プラグインルート解決 -------------------------------------------
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

// CLAUDE_PLUGIN_ROOT（フック実行時に設定される）優先。無ければこのファイルの 1 つ上。
function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, "..");
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// このプラグインの名前（marketplace.json の plugin entry 照合 / enabledPlugins 照合に使う）。
function pluginName() {
  const manifest = readJson(path.join(pluginRoot(), ".claude-plugin", "plugin.json"));
  return (manifest && manifest.name) || "workflow";
}

// pluginRoot から上位へ `.claude-plugin/marketplace.json` を探索（dev / 配布キャッシュ両対応）。
// 配布時は <cache>/<marketplace>/plugins/workflow なので、上位に marketplace.json が在る。
function findMarketplaceJson(start) {
  let dir = start;
  for (;;) {
    const p = path.join(dir, ".claude-plugin", "marketplace.json");
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// repository URL / 短縮形 → "owner/repo"。github 以外や解析不能は null。
function parseRepo(url) {
  if (!url) return null;
  const s = String(url).trim().replace(/\.git$/i, "");
  // git@github.com:owner/repo / https://github.com/owner/repo
  const m = s.match(/github\.com[:/]+([^/\s]+\/[^/\s]+?)$/i);
  if (m) return m[1];
  // 既に "owner/repo" 短縮形
  if (/^[^/\s]+\/[^/\s]+$/.test(s)) return s;
  return null;
}

// ---- marketplace 名 / repo の決定（override > marketplace.json） --------------
let marketplaceName = marketplaceOverride;
let repo = repoOverride ? parseRepo(repoOverride) : null;

if (!marketplaceName || !repo) {
  const mpPath = findMarketplaceJson(pluginRoot());
  const mp = mpPath ? readJson(mpPath) : null;
  if (mp) {
    if (!marketplaceName && mp.name) marketplaceName = mp.name;
    if (!repo) {
      const name = pluginName();
      const entry = Array.isArray(mp.plugins) ? mp.plugins.find((p) => p && p.name === name) : null;
      repo = parseRepo(entry && entry.repository) || parseRepo(mp.repository);
    }
  }
}

if (!marketplaceName || !repo) {
  console.error(
    "[apply-auto-update] marketplace 名 / GitHub repo を特定できませんでした。" +
      " --marketplace <name> と --repo <owner/repo> を指定するか、" +
      " 利用者に /plugin → Marketplaces → Enable auto-update を案内してください。"
  );
  process.exit(1);
}

// ---- 適用先スコープの決定（apply-permissions.js と同一ロジック） -------------
function findProjectRoot() {
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, ".claude")) || fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

function pathForScope(s, root) {
  if (s === "user") return path.join(homeDir(), ".claude", "settings.json");
  if (s === "local") return path.join(root, ".claude", "settings.local.json");
  return path.join(root, ".claude", "settings.json"); // project
}

function pluginEnabledIn(settingsPath, name) {
  const s = readJson(settingsPath);
  if (!s || !s.enabledPlugins) return false;
  return Object.entries(s.enabledPlugins).some(([k, v]) => v === true && k.startsWith(name + "@"));
}

function detectScope(root) {
  const name = pluginName();
  if (pluginEnabledIn(pathForScope("local", root), name)) return "local";
  if (pluginEnabledIn(pathForScope("project", root), name)) return "project";
  return "user";
}

const targetExplicit = targetPath != null;
const projectRoot = findProjectRoot();
const effectiveScope = scope || detectScope(projectRoot);
if (!targetPath) {
  targetPath = pathForScope(effectiveScope, projectRoot);
}
const scopeNote = targetExplicit
  ? "--target 明示"
  : scope
  ? `--scope ${scope}`
  : `自動判定 → ${effectiveScope}`;
console.log(`[apply-auto-update] 適用スコープ: ${scopeNote}（${targetPath}）`);
console.log(`[apply-auto-update] 対象 marketplace: ${marketplaceName}（github:${repo}）`);

// ---- 既存 settings 読み込み --------------------------------------------------
const target = readJson(targetPath) || {};
if (typeof target !== "object" || Array.isArray(target)) {
  console.error(`[apply-auto-update] 既存 settings の形式が不正です: ${targetPath}`);
  process.exit(1);
}

// ---- マージ（冪等。既存の他フィールド・他マーケットプレイスは保持） ----------
if (!target.extraKnownMarketplaces || typeof target.extraKnownMarketplaces !== "object") {
  target.extraKnownMarketplaces = {};
}
const before = JSON.stringify(target.extraKnownMarketplaces[marketplaceName] || null);

const entry = { ...(target.extraKnownMarketplaces[marketplaceName] || {}) };
// source は未設定時のみ補う（利用者が独自に設定済みの source は壊さない）。
if (!entry.source || typeof entry.source !== "object") {
  entry.source = { source: "github", repo };
  if (refOverride) entry.source.ref = refOverride;
}
entry.autoUpdate = true;
target.extraKnownMarketplaces[marketplaceName] = entry;

const after = JSON.stringify(entry);
const changed = before !== after;

// ---- 出力 --------------------------------------------------------------------
if (dryRun) {
  console.log(`[apply-auto-update] dry-run: ${targetPath}`);
  if (changed) {
    console.log(`  + extraKnownMarketplaces.${marketplaceName}.autoUpdate = true`);
    console.log(`      source = github:${repo}${refOverride ? ` (ref:${refOverride})` : ""}`);
  } else {
    console.log("  変更なし（既に auto-update 有効）");
  }
  process.exit(0);
}

if (!changed) {
  console.log(`[apply-auto-update] 既に有効（変更なし）: ${targetPath}`);
  process.exit(0);
}

// 親ディレクトリ作成（recursive）→ atomic write（tmp に書いて rename）。
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
const tmpPath = targetPath + ".tmp";
fs.writeFileSync(tmpPath, JSON.stringify(target, null, 2) + "\n", "utf8");
fs.renameSync(tmpPath, targetPath);

console.log(`[apply-auto-update] 適用完了: ${targetPath}`);
console.log(`  + extraKnownMarketplaces.${marketplaceName}.autoUpdate = true（github:${repo}）`);
console.log("  以降、Claude Code 起動時にこの marketplace を自動更新します。");
