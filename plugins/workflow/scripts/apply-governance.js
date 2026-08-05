#!/usr/bin/env node
//
// BELTA workflow plugin — ガバナンス設定の適用（permissions 以外）
//
// 同梱の権威ソース `<plugin>/.claude/settings.json` のうち、permissions ではない
// ガバナンスキー（sandbox / allowedMcpServers / model / cleanupPeriodDays）を、
// 利用者の settings（既定は専用フォルダの settings.local.json）へマージする。
// permissions は scripts/apply-permissions.js の担当（マージ規則が違うので分離した）。
//
//   apply-permissions.js … 配列の和集合のみ（既存ルールを削除しない）
//   apply-governance.js  … オブジェクト再帰マージ / 配列和集合 / スカラは権威優先で上書き
//                          ＋ 前回適用スナップショットで「権威から消えたキー」だけ削除
//
// 使い方:
//   node scripts/apply-governance.js [--scope user|project|local] [--target <path>]
//                                    [--mcp-servers <a,b,c>] [--dry-run]
//
//   適用先の決定は apply-permissions.js と同じ優先順（--target > --scope > 自動判定）。
//   --mcp-servers … allowedMcpServers を明示上書き（カンマ区切りのサーバ名）。
//                   省略時は ~/.belta/config.yaml の mcp_allowlist → 権威 settings の順。
//   --dry-run     … 書き込まず差分のみ表示。
//
// 設計（クロスプラットフォーム規約）:
//   - シェル非依存の Node.js のみ。パスは path API、ホームは環境変数から解決。
//   - atomic write（tmp → rename）。冪等（差分ゼロなら書き込まない）。
//   - 利用者が独自に足したキー（管理対象外）には一切触らない。
//   - Windows ネイティブは sandbox 非対応だが、settings に sandbox キーが入っていても
//     failIfUnavailable:false のためセッションは壊れない（権威側でそう固定している）。

const fs = require("fs");
const path = require("path");
const os = require("os");

// このスクリプトが管理するキー（権威ソースにあればコピー、無ければ前回適用分を撤去）
const MANAGED_KEYS = ["sandbox", "allowedMcpServers", "cleanupPeriodDays", "model"];

// マージ方針の例外:
//   model は「利用者が消したら尊重する」弱いマージ（未設定なら入れるが、既存値は上書きしない）。
//   セキュリティ値（sandbox / allowedMcpServers / cleanupPeriodDays）は権威優先で上書きする。
const SOFT_KEYS = new Set(["model"]);

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let targetPath = null;
let scope = null;
let dryRun = false;
let mcpServersArg = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--target") targetPath = argv[++i];
  else if (argv[i] === "--scope") scope = argv[++i];
  else if (argv[i] === "--mcp-servers") mcpServersArg = argv[++i];
  else if (argv[i] === "--dry-run") dryRun = true;
}

if (scope && !["user", "project", "local"].includes(scope)) {
  console.error(`[apply-governance] --scope は user / project / local のいずれか: ${scope}`);
  process.exit(1);
}

// ---- パス解決 ----------------------------------------------------------------
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

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

function pluginName() {
  const manifest = readJson(path.join(pluginRoot(), ".claude-plugin", "plugin.json"));
  return (manifest && manifest.name) || "workflow";
}

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

// ---- config.yaml（フラット YAML の 1 行パース。belta-init.js と同形式）--------
function readBeltaConfig() {
  const p = path.join(homeDir(), ".belta", "config.yaml");
  const map = {};
  let text = "";
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    return map;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    map[key] = val;
  }
  return map;
}

// ---- 適用先の決定 ------------------------------------------------------------
const targetExplicit = targetPath != null;
const projectRoot = findProjectRoot();
const effectiveScope = scope || detectScope(projectRoot);
if (!targetPath) targetPath = pathForScope(effectiveScope, projectRoot);

const scopeNote = targetExplicit
  ? "--target 明示"
  : scope
  ? `--scope ${scope}`
  : `自動判定 → ${effectiveScope}`;
console.log(`[apply-governance] 適用スコープ: ${scopeNote}（${targetPath}）`);

// ---- 権威ソース読み込み ------------------------------------------------------
const sourcePath = path.join(pluginRoot(), ".claude", "settings.json");
const source = readJson(sourcePath);
if (!source) {
  console.error(`[apply-governance] 権威ソースが読めません: ${sourcePath}`);
  process.exit(1);
}

// 権威ソースから管理対象キーだけ取り出す
const desired = {};
for (const key of MANAGED_KEYS) {
  if (source[key] !== undefined) desired[key] = source[key];
}

// allowedMcpServers の実名上書き（--mcp-servers > config.yaml mcp_allowlist > 権威）
const cfg = readBeltaConfig();
const mcpNamesRaw = mcpServersArg != null ? mcpServersArg : cfg.mcp_allowlist || "";
const mcpNames = String(mcpNamesRaw)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (mcpNames.length > 0) {
  desired.allowedMcpServers = mcpNames.map((serverName) => ({ serverName }));
  console.log(`[apply-governance] allowedMcpServers を実名で上書き: ${mcpNames.join(", ")}`);
}
// 空の allowlist は「全 MCP 使用不可」を意味してしまうので絶対に書かない（fail-open）。
if (Array.isArray(desired.allowedMcpServers) && desired.allowedMcpServers.length === 0) {
  delete desired.allowedMcpServers;
  console.log("[apply-governance] allowedMcpServers が空のため適用をスキップしました");
}

// ---- 既存 settings ------------------------------------------------------------
const target = readJson(targetPath) || {};
if (typeof target !== "object" || Array.isArray(target)) {
  console.error(`[apply-governance] 既存 settings の形式が不正です: ${targetPath}`);
  process.exit(1);
}

// ---- 前回適用スナップショット（削除伝播用）-----------------------------------
// 「自分が過去に書いたが権威から消えたキー」だけを撤去する。利用者手動設定は誤削除しない。
const snapshotPath = path.join(homeDir(), ".belta", "audit", "governance-applied.json");
function readSnapshot() {
  const all = readJson(snapshotPath);
  if (!all || typeof all !== "object") return {};
  const entry = all[targetPath];
  return entry && typeof entry === "object" ? entry : {};
}
function writeSnapshot(appliedKeys) {
  const all = readJson(snapshotPath) || {};
  all[targetPath] = { keys: appliedKeys, applied_at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const tmp = snapshotPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, snapshotPath);
}

const prevKeys = Array.isArray(readSnapshot().keys) ? readSnapshot().keys : [];

// ---- マージ ------------------------------------------------------------------
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// オブジェクト＝再帰マージ / 配列＝和集合（順序は既存→権威）/ スカラ＝権威優先
function mergeValue(existing, incoming) {
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const out = { ...existing };
    for (const k of Object.keys(incoming)) out[k] = mergeValue(existing[k], incoming[k]);
    return out;
  }
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    const out = existing.slice();
    const seen = new Set(existing.map((v) => JSON.stringify(v)));
    for (const v of incoming) {
      const k = JSON.stringify(v);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(v);
      }
    }
    return out;
  }
  return incoming;
}

const changes = [];
const appliedKeys = [];

for (const key of MANAGED_KEYS) {
  const incoming = desired[key];
  const existing = target[key];

  if (incoming === undefined) {
    // 権威から消えたキー: 前回自分が書いたものだけ撤去する
    if (existing !== undefined && prevKeys.includes(key)) {
      delete target[key];
      changes.push(`- ${key}（権威ソースから削除されたため撤去）`);
    }
    continue;
  }

  appliedKeys.push(key);

  if (SOFT_KEYS.has(key) && existing !== undefined) {
    // 弱いマージ: 既存値を尊重（利用者が /model 相当を手で変えたのを上書きしない）
    continue;
  }

  const merged = mergeValue(existing, incoming);
  if (JSON.stringify(existing) !== JSON.stringify(merged)) {
    target[key] = merged;
    changes.push(`${existing === undefined ? "+" : "~"} ${key}`);
  }
}

// permissions のうち、非配列のガバナンス系サブキー（disableBypassPermissionsMode 等）も届ける。
// allow/ask/deny の配列は apply-permissions.js の担当なので触らない。
const srcPerm = isPlainObject(source.permissions) ? source.permissions : {};
const PERM_SCALARS = ["disableBypassPermissionsMode", "disableAutoMode", "defaultMode"];
for (const key of PERM_SCALARS) {
  if (srcPerm[key] === undefined) continue;
  if (!isPlainObject(target.permissions)) target.permissions = {};
  if (target.permissions[key] !== srcPerm[key]) {
    target.permissions[key] = srcPerm[key];
    changes.push(`~ permissions.${key} = ${JSON.stringify(srcPerm[key])}`);
  }
}

// ---- 出力 --------------------------------------------------------------------
if (changes.length === 0) {
  console.log(`[apply-governance] 既に適用済み（変更なし）: ${targetPath}`);
  if (!dryRun) {
    try {
      writeSnapshot(appliedKeys);
    } catch {
      /* スナップショット失敗は致命ではない */
    }
  }
  process.exit(0);
}

if (dryRun) {
  console.log(`[apply-governance] dry-run: ${targetPath}`);
  for (const c of changes) console.log(`  ${c}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(targetPath), { recursive: true });
const tmpPath = targetPath + ".tmp";
fs.writeFileSync(tmpPath, JSON.stringify(target, null, 2) + "\n", "utf8");
fs.renameSync(tmpPath, targetPath);

try {
  writeSnapshot(appliedKeys);
} catch {
  /* スナップショット失敗は致命ではない（次回の削除伝播が効かないだけ） */
}

console.log(`[apply-governance] 適用完了: ${targetPath}`);
for (const c of changes) console.log(`  ${c}`);
if (desired.allowedMcpServers) {
  console.log(
    "  注意: allowedMcpServers はホワイトリストです。/mcp で表示されるサーバ名と一致しない場合、" +
      "その MCP は使えなくなります。実名を確認して --mcp-servers か config.yaml の mcp_allowlist で調整してください。"
  );
}
