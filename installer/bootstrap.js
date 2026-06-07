#!/usr/bin/env node
//
// Belta workflow agent — スタンドアロン・ブートストラップ・インストーラー（Mac / Windows 両対応）
//
// 「プラグイン導入前」に単体で動く自己完結インストーラー。Mac の install.command /
// Windows の install.bat（ダブルクリック起動するランチャー）から呼ばれる想定。
// プラグイン本体や兄弟スクリプト（setup-agent-home.js 等）に一切依存しない
// （導入前には存在しないため）。仕様:
//
//   1. メールアドレスを入力させる（readline の標準入力プロンプト。--email で非対話も可）。
//   2. ドメインが belta.co.jp であることを検証する（不一致は再入力／中止）。
//   3. 「@ より前（ローカルパート）」＋ -agent をフォルダ名とし、ホーム直下
//      （POSIX:$HOME / Windows:%USERPROFILE%）に作成する。
//   4. そのフォルダに settings.local.json を書き、プラグインを「展開」する準備を整える。
//      → このフォルダを Claude Code で開くと、Claude Code 自身が marketplace から
//        プラグインを取得・有効化する（手作業のコピー展開は不要）。
//      あわせて ~/.belta を最小初期化（owner_email / agent_home を記録）する。
//
// 設計（cross-platform.md 準拠）:
//   - シェル非依存の Node.js 単一実装。OS 依存コマンド（mkdir -p / cp / ln -s）を使わない。
//   - パスは path.join、ホームは環境変数 / os.homedir() から解決。atomic write（tmp→rename）。
//   - 例外時も安全側へ。必須ステップ失敗は中止、付随ステップ失敗は警告のみで継続。
//   - config.yaml はここでは最小限だけ書き、足りない既定はプラグイン側の belta-init.js が
//     初回 /workflow-setup で補完する（belta-init は「欠けているものだけ補う」冪等設計）。

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

// ---- 配布定数（marketplace.json / plugin.json と一致させる）------------------
const PLUGIN_NAME = "workflow";
const MARKETPLACE_NAME = "belta-workflow-agent";
const REPO = "belta-group/belta-workflow-agent";
const REQUIRED_DOMAIN = "belta.co.jp";

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let emailArg = null;
let baseOverride = null;
let refOverride = null;
let repoOverride = null;
let dryRun = false;
let maxAttempts = 3;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--email") emailArg = argv[++i];
  else if (a === "--base") baseOverride = argv[++i];
  else if (a === "--ref") refOverride = argv[++i];
  else if (a === "--repo") repoOverride = argv[++i];
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--max-attempts") maxAttempts = parseInt(argv[++i], 10) || 3;
  else if (a === "-h" || a === "--help") {
    process.stdout.write(
      [
        "Belta workflow agent ブートストラップ・インストーラー",
        "  node bootstrap.js [--email system-bot@belta.co.jp] [--base <dir>]",
        "                    [--ref <branch|tag>] [--repo <owner/repo>]",
        "                    [--dry-run] [--max-attempts <n>]",
        "",
      ].join("\n")
    );
    process.exit(0);
  }
}
const repo = repoOverride || REPO;

// ---- パス解決 ----------------------------------------------------------------
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}
const base = baseOverride ? path.resolve(baseOverride) : homeDir();
const beltaDir = baseOverride ? path.join(base, ".belta") : path.join(homeDir(), ".belta");

// ---- メール検証 / フォルダ名生成 --------------------------------------------
function validateEmail(raw) {
  const email = String(raw == null ? "" : raw).trim();
  if (!email) return { ok: false, reason: "メールアドレスが空です。" };
  const m = email.match(/^([^\s@]+)@([^\s@]+)$/);
  if (!m) return { ok: false, reason: `メールアドレスの形式が不正です: ${email}` };
  const localPart = m[1];
  const domain = m[2].toLowerCase();
  if (domain !== REQUIRED_DOMAIN) {
    return {
      ok: false,
      reason: `ドメインが ${REQUIRED_DOMAIN} ではありません（入力: @${domain}）。${REQUIRED_DOMAIN} のアドレスを使ってください。`,
    };
  }
  return { ok: true, email, localPart, domain };
}

// ローカルパートをファイルシステムで安全なフォルダ名要素へ整える。
function toFolderBase(localPart) {
  let s = localPart.replace(/[^A-Za-z0-9._-]/g, "-");
  s = s.replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return s;
}

// ---- 対話プロンプト（行キュー方式。パイプ入力でも取りこぼさない／EOF で null） ----
function makeAsker() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on("line", (line) => {
    if (waiters.length) waiters.shift()(line);
    else queue.push(line);
  });
  rl.on("close", () => {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  });
  const ask = (question) =>
    new Promise((resolve) => {
      process.stdout.write(question);
      if (queue.length) return resolve(queue.shift());
      if (closed) return resolve(null);
      waiters.push(resolve);
    });
  return { ask, close: () => rl.close() };
}

async function resolveEmail() {
  if (emailArg != null) {
    const v = validateEmail(emailArg);
    if (!v.ok) fail(`--email の値が無効です。${v.reason}`);
    return v;
  }
  const asker = makeAsker();
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ans = await asker.ask(`メールアドレスを入力してください（@${REQUIRED_DOMAIN}）: `);
      const v = validateEmail(ans);
      if (v.ok) return v;
      process.stdout.write(`  ✗ ${v.reason}\n`);
    }
  } finally {
    asker.close();
  }
  fail(`メールアドレスの検証に ${maxAttempts} 回失敗しました。中止します。`);
}

// ---- 補助 --------------------------------------------------------------------
function fail(message) {
  process.stderr.write(`\n[bootstrap] エラー: ${message}\n`);
  process.exit(1);
}
function warn(message) {
  process.stdout.write(`[bootstrap] 警告: ${message}\n`);
}
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
function atomicWrite(p, content, mode) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  const opts = mode ? { mode } : undefined;
  fs.writeFileSync(tmp, content, opts);
  fs.renameSync(tmp, p);
}

// ---- settings.local.json マージ（setup-agent-home.js と同じ構造を冪等生成） ----
function writeSettings(folder) {
  const enabledKey = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
  const settingsPath = path.join(folder, ".claude", "settings.local.json");
  const existing = readJson(settingsPath) || {};
  if (typeof existing !== "object" || Array.isArray(existing)) {
    fail(`既存 settings.local.json の形式が不正: ${settingsPath}`);
  }
  const next = { ...existing };
  next.enabledPlugins = { ...(existing.enabledPlugins || {}) };
  next.extraKnownMarketplaces = { ...(existing.extraKnownMarketplaces || {}) };
  next.enabledPlugins[enabledKey] = true;

  const mpEntry = { ...(next.extraKnownMarketplaces[MARKETPLACE_NAME] || {}) };
  if (!mpEntry.source || typeof mpEntry.source !== "object") {
    mpEntry.source = { source: "github", repo };
    if (refOverride) mpEntry.source.ref = refOverride;
  }
  if (mpEntry.autoUpdate === undefined) mpEntry.autoUpdate = true;
  next.extraKnownMarketplaces[MARKETPLACE_NAME] = mpEntry;

  if (!dryRun) atomicWrite(settingsPath, JSON.stringify(next, null, 2) + "\n");
  return settingsPath;
}

// ---- .gitignore（誤コミット防止。既存は壊さない） ----------------------------
function writeGitignore(folder) {
  const p = path.join(folder, ".gitignore");
  if (fs.existsSync(p)) return;
  const body = [
    "# Belta workflow agent — このフォルダ内の Claude Code 個人設定/生成物は共有しない",
    ".claude/settings.local.json",
    ".claude/agents/",
    ".claude/skills/",
    "",
  ].join("\n");
  if (!dryRun) atomicWrite(p, body);
}

// ---- ~/.belta の最小初期化（足りない既定は belta-init.js が後で補完） ---------
function initBelta(email, folder) {
  if (dryRun) return;
  fs.mkdirSync(beltaDir, { recursive: true });
  for (const sub of ["notes", "inbox", "todos", "memory"]) {
    fs.mkdirSync(path.join(beltaDir, sub), { recursive: true });
  }
  // config.yaml はフラット YAML。既存値があれば壊さず、owner_email / agent_home を権威値で上書き。
  const configPath = path.join(beltaDir, "config.yaml");
  const cfg = parseFlatYaml(safeRead(configPath));
  if (!cfg.version) cfg.version = "1";
  if (!cfg.created_at) cfg.created_at = new Date().toISOString();
  cfg.owner_email = email;
  cfg.agent_home = folder;
  atomicWrite(configPath, serializeFlatYaml(cfg), 0o600);
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    /* Windows 等では no-op */
  }
}
function safeRead(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
function parseFlatYaml(text) {
  const map = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
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
function serializeFlatYaml(map) {
  const lines = [
    "# Belta config（machine-readable）。bootstrap が最小値を記録。残りは belta-init.js が補完。",
  ];
  for (const k of Object.keys(map)) {
    const s = String(map[k]);
    const v =
      s === "true" || s === "false" || /^-?\d+$/.test(s)
        ? s
        : `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    lines.push(`${k}: ${v}`);
  }
  return lines.join("\n") + "\n";
}

// ---- メイン ------------------------------------------------------------------
(async () => {
  process.stdout.write("Belta workflow agent インストーラー\n\n");
  const { email, localPart } = await resolveEmail();

  const folderBase = toFolderBase(localPart);
  if (!folderBase) {
    fail(`メールのローカルパート「${localPart}」から有効なフォルダ名を作れませんでした。`);
  }
  const folder = path.join(base, `${folderBase}-agent`);

  process.stdout.write(`\n[bootstrap] メール: ${email}\n`);
  process.stdout.write(`[bootstrap] 作成フォルダ: ${folder}\n`);
  if (dryRun) process.stdout.write(`[bootstrap] （--dry-run: 実際には書き込みません）\n`);
  process.stdout.write("\n");

  // (1/3) 専用フォルダ + プラグイン有効化設定
  process.stdout.write("[bootstrap] (1/3) 専用フォルダ + プラグイン有効化設定 …\n");
  let settingsPath;
  try {
    settingsPath = writeSettings(folder);
    writeGitignore(folder);
  } catch (e) {
    fail(`settings.local.json の生成に失敗しました。${String((e && e.message) || e)}`);
  }
  process.stdout.write(`        → ${settingsPath}\n`);

  // (2/3) ~/.belta 最小初期化
  process.stdout.write("[bootstrap] (2/3) ~/.belta 初期化（owner_email / agent_home 記録）…\n");
  try {
    initBelta(email, folder);
  } catch (e) {
    warn(`~/.belta の初期化に失敗しました（継続します）。${String((e && e.message) || e)}`);
  }

  // (3/3) 完了案内
  process.stdout.write("[bootstrap] (3/3) 完了。\n");
  process.stdout.write(
    [
      "",
      "✅ インストール準備が完了しました。",
      "",
      "次のステップ:",
      `  1. Claude Code で次のフォルダを開く:`,
      `       ${folder}`,
      `     （初回オープン時に Claude Code がプラグイン本体を自動取得・有効化します）`,
      "  2. そのフォルダ内で /workflow-setup を実行し、プロフィール（氏名・部署など）と",
      "     MCP 4 ツール（Notion / Slack / Google Drive / GitHub）の OAuth 接続を済ませる。",
      "",
      "※ Claude Code（Max / Team / Enterprise プラン）が未導入の場合は、先に導入してください。",
      "",
    ].join("\n")
  );
  process.exit(0);
})().catch((e) => {
  fail(String((e && e.message) || e));
});
