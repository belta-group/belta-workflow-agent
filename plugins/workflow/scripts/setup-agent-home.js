#!/usr/bin/env node
//
// Belta workflow plugin — 専用フォルダ（~/my-agent）の作成 + ローカル有効化
//
// 本プラグインは「ホーム直下の専用フォルダ限定（ローカルスコープ）でだけ発火する」
// 運用を既定とする。グローバル（ユーザースコープ）有効化は、業務と無関係なあらゆる
// セッションでワークフローの作法が発火してしまうため避ける。
//
// このスクリプトは:
//   1. ~/my-agent（衝突時は my-agent-2, my-agent-3 …）を作成し、
//   2. <folder>/.claude/settings.local.json に enabledPlugins + extraKnownMarketplaces を
//      冪等マージして「そのフォルダ配下でだけ」本プラグインを有効化し、
//   3. 選んだ絶対パスを JSON で stdout に返す（呼び出し側＝/workflow-setup が利用者へ提示）。
//
// 使い方:
//   node scripts/setup-agent-home.js [--base <dir>] [--name <folder>] [--dir <abs path>]
//                                    [--marketplace <name>] [--repo <owner/repo>]
//                                    [--ref <branch|tag>] [--dry-run]
//
//   --dir <abs>      … 作成/利用するフォルダの絶対パスを明示（最優先）。
//   --base <dir>     … 基点ディレクトリ（既定はホーム。POSIX:$HOME / Windows:%USERPROFILE%）。
//   --name <folder>  … フォルダ名を固定（既定は my-agent。既存・自分のagent homeなら再利用）。
//   marketplace/repo … 既定は同梱 marketplace.json から自動取得。
//
// 冪等性:
//   - 既に「自分の agent home（settings.local.json に本プラグイン有効化あり）」が存在すれば
//     新規作成せず再利用する（再実行で my-agent-2 を無限増殖させない）。
//   - 既存 settings.local.json の他キーは保持し、enabledPlugins / extraKnownMarketplaces のみ
//     和集合マージする。
//
// 設計（クロスプラットフォーム規約 cross-platform.md 準拠）:
//   - シェル非依存の Node.js のみ（mkdir -p / ln -s / cp に依存しない。fs API を使う）。
//   - パスは path.join、ホームは環境変数から解決。JSON 入出力は JSON.stringify に委ねる。
//   - atomic write（tmp→rename）。例外時も JSON で状態を返し、呼び出し側に判断させる。

const fs = require("fs");
const path = require("path");
const os = require("os");

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let baseOverride = null;
let nameOverride = null;
let dirOverride = null;
let marketplaceOverride = null;
let repoOverride = null;
let refOverride = null;
let dryRun = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--base") baseOverride = argv[++i];
  else if (argv[i] === "--name") nameOverride = argv[++i];
  else if (argv[i] === "--dir") dirOverride = argv[++i];
  else if (argv[i] === "--marketplace") marketplaceOverride = argv[++i];
  else if (argv[i] === "--repo") repoOverride = argv[++i];
  else if (argv[i] === "--ref") refOverride = argv[++i];
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

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// このプラグインの名前（enabledPlugins キー "<name>@<marketplace>" の <name>）。
function pluginName() {
  const manifest = readJson(path.join(pluginRoot(), ".claude-plugin", "plugin.json"));
  return (manifest && manifest.name) || "workflow";
}

// pluginRoot から上位へ marketplace.json を探索（dev / 配布キャッシュ両対応）。
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
  const m = s.match(/github\.com[:/]+([^/\s]+\/[^/\s]+?)$/i);
  if (m) return m[1];
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
  // marketplace を特定できないと enabledPlugins キーを組めない。状態を JSON で返して終了。
  process.stdout.write(
    JSON.stringify({
      ok: false,
      message:
        "marketplace 名 / GitHub repo を特定できませんでした。--marketplace と --repo を指定してください。",
    }) + "\n"
  );
  process.exit(0);
}

const enabledKey = `${pluginName()}@${marketplaceName}`;

// ---- 対象フォルダの決定（--dir > --name 固定 > 衝突回避の自動採番） ----------
const base = baseOverride || homeDir();

// settings.local.json に本プラグイン有効化があれば「自分の agent home」。
function isOurAgentHome(folder) {
  const s = readJson(path.join(folder, ".claude", "settings.local.json"));
  if (!s || !s.enabledPlugins) return false;
  return s.enabledPlugins[enabledKey] === true;
}

function pickFolder() {
  if (dirOverride) return { folder: path.resolve(dirOverride), reused: fs.existsSync(dirOverride) };
  if (nameOverride) {
    const folder = path.join(base, nameOverride);
    return { folder, reused: fs.existsSync(folder) };
  }
  // my-agent, my-agent-2, my-agent-3 … を順に見る。
  //   - 存在しない → そこを作る。
  //   - 存在し、自分の agent home → 再利用（無限増殖を防ぐ）。
  //   - 存在するが他人のフォルダ → 次の候補へ。
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? "my-agent" : `my-agent-${n}`;
    const folder = path.join(base, name);
    if (!fs.existsSync(folder)) return { folder, reused: false };
    if (isOurAgentHome(folder)) return { folder, reused: true };
  }
  return { folder: path.join(base, `my-agent-${Date.now()}`), reused: false };
}

const { folder, reused } = pickFolder();
const settingsPath = path.join(folder, ".claude", "settings.local.json");

// ---- settings.local.json をマージ（冪等。他キー保持） ------------------------
const existing = readJson(settingsPath) || {};
if (typeof existing !== "object" || Array.isArray(existing)) {
  process.stdout.write(
    JSON.stringify({ ok: false, message: `既存 settings.local.json の形式が不正: ${settingsPath}` }) + "\n"
  );
  process.exit(0);
}

const next = { ...existing };
next.enabledPlugins = { ...(existing.enabledPlugins || {}) };
next.extraKnownMarketplaces = { ...(existing.extraKnownMarketplaces || {}) };

const beforeEnabled = next.enabledPlugins[enabledKey] === true;
next.enabledPlugins[enabledKey] = true;

// marketplace の source は未設定時のみ補う（利用者が独自設定した source は壊さない）。
const mpEntry = { ...(next.extraKnownMarketplaces[marketplaceName] || {}) };
const beforeMp = JSON.stringify(next.extraKnownMarketplaces[marketplaceName] || null);
if (!mpEntry.source || typeof mpEntry.source !== "object") {
  mpEntry.source = { source: "github", repo };
  if (refOverride) mpEntry.source.ref = refOverride;
}
next.extraKnownMarketplaces[marketplaceName] = mpEntry;
const afterMp = JSON.stringify(mpEntry);

const changed = !beforeEnabled || beforeMp !== afterMp || !fs.existsSync(settingsPath);

if (dryRun) {
  process.stdout.write(
    JSON.stringify(
      { ok: true, dryRun: true, path: folder, settings: settingsPath, reused, enabledKey, changed },
      null,
      2
    ) + "\n"
  );
  process.exit(0);
}

// ---- 作成 + atomic write -----------------------------------------------------
try {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = settingsPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, settingsPath);

  // 専用フォルダに .gitignore を冪等生成（誤コミット防止）。
  // 既存があれば壊さない（利用者が編集済みの可能性）。ローカル設定と生成物を共有しない。
  const gitignorePath = path.join(folder, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    const body = [
      "# Belta workflow agent — このフォルダ内の Claude Code 個人設定/生成物は共有しない",
      ".claude/settings.local.json",
      ".claude/agents/",
      ".claude/skills/",
      "",
    ].join("\n");
    fs.writeFileSync(gitignorePath, body, "utf8");
  }
} catch (e) {
  process.stdout.write(
    JSON.stringify({ ok: false, path: folder, settings: settingsPath, message: String(e && e.message) }) + "\n"
  );
  process.exit(0);
}

// 成功。呼び出し側はこの path を agent_home として記録・利用者へ提示する。
process.stdout.write(
  JSON.stringify({ ok: true, path: folder, settings: settingsPath, reused, enabledKey, changed }) + "\n"
);
process.exit(0);
