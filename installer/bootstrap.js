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
const { spawnSync } = require("child_process");

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
let noClaude = false; // claude CLI を使わず宣言的フォールバックに固定
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--email") emailArg = argv[++i];
  else if (a === "--base") baseOverride = argv[++i];
  else if (a === "--ref") refOverride = argv[++i];
  else if (a === "--repo") repoOverride = argv[++i];
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--no-claude") noClaude = true;
  else if (a === "--max-attempts") maxAttempts = parseInt(argv[++i], 10) || 3;
  else if (a === "-h" || a === "--help") {
    process.stdout.write(
      [
        "Belta workflow agent ブートストラップ・インストーラー",
        "  node bootstrap.js [--email system-bot@belta.co.jp] [--base <dir>]",
        "                    [--ref <branch|tag>] [--repo <owner/repo>]",
        "                    [--no-claude] [--dry-run] [--max-attempts <n>]",
        "",
        "  --no-claude   claude CLI を使わず（自動導入もせず）settings を宣言的に書くだけ",
        "                ※ 既定は: claude CLI が無ければ公式インストーラーで自動導入し、",
        "                  PATH を通したうえでターミナル再起動を案内する",
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

// ---- claude CLI 連携 ---------------------------------------------------------
const IS_WIN = process.platform === "win32";

// claude CLI が使えるか判定（--version が 0 で返れば利用可）。Windows は .cmd 解決のため shell。
function findClaude() {
  try {
    const r = spawnSync("claude", ["--version"], { stdio: "ignore", shell: IS_WIN });
    if (r && r.status === 0) return "claude";
  } catch {
    /* ENOENT 等は未導入とみなす */
  }
  return null;
}

// claude をフォルダ内で実行（plugin コマンド）。stdio:inherit でそのまま画面に出す。
function runClaude(args, cwd, stdio) {
  return spawnSync("claude", args, { cwd, stdio: stdio || "inherit", shell: IS_WIN });
}

// ---- claude CLI 自動インストール（フォールバック） ---------------------------
//
// claude CLI が無いときに公式インストーラーで導入する。インストール手段自体は
// 本質的に OS 依存（curl / PowerShell / brew / npm）なので、ここは cross-platform.md の
// 「OS 依存コマンドを必須経路に置かない」原則の許容例外。ただしパス解決・冪等性・
// fail-open（失敗しても中止せず手動案内へ縮退）は引き続き厳守する。
//
// 方針: 公式ネイティブインストーラーを第一候補、npm を最終フォールバック。
//       macOS では Homebrew / ネイティブを利用者に選ばせる（対話時のみ）。
// インストール先（公式ネイティブ）: POSIX=$HOME/.local/bin/claude, Windows=%USERPROFILE%\.local\bin\claude.exe
// PATH はネイティブインストーラーが自動で通すが、保険として ensureClaudeOnPath で冪等に補う。
// 同一プロセスでは PATH 変更が反映されないため、導入後は「ターミナル再起動」を案内して終了する。

// 公式ネイティブのインストール先 bin ディレクトリ（~/.local/bin）。
function claudeBinDir() {
  return path.join(homeDir(), ".local", "bin");
}

// あるディレクトリが現在の PATH に含まれるか（Windows は大文字小文字と末尾区切りを無視）。
function isOnPath(dir) {
  const sep = IS_WIN ? ";" : ":";
  const norm = (s) => {
    let v = String(s || "").replace(/[\\/]+$/, "");
    return IS_WIN ? v.toLowerCase() : v;
  };
  const target = norm(dir);
  return String(process.env.PATH || "")
    .split(sep)
    .some((e) => norm(e) === target);
}

// shell コマンド文字列を実行（パイプを含む native installer 用）。stdio:inherit で進捗を表示。
function runShell(cmd) {
  return spawnSync(cmd, { stdio: "inherit", shell: true });
}

// 指定 CLI が使えるか（--version が 0 で返れば true）。
function commandWorks(bin) {
  try {
    const r = spawnSync(bin, ["--version"], { stdio: "ignore", shell: IS_WIN });
    return !!(r && r.status === 0);
  } catch {
    return false;
  }
}

// 各インストール手段（成功時 status===0）。
function installNative() {
  if (IS_WIN) {
    // Windows PowerShell（5.1）は常に存在。プロファイル無効・実行ポリシー回避で公式 ps1 を実行。
    return spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"],
      { stdio: "inherit" }
    );
  }
  return runShell("curl -fsSL https://claude.ai/install.sh | bash");
}
function installBrew() {
  return runShell("brew install --cask claude-code");
}
function installNpm() {
  return runShell("npm install -g @anthropic-ai/claude-code");
}

// claude CLI を自動インストールする。成功可否と採用手段を返す（fail-open）。
async function installClaude() {
  process.stdout.write(
    "[bootstrap] Claude Code CLI が見つかりません。公式インストーラーで自動導入を試みます。\n"
  );

  const attempts = [];
  if (process.platform === "darwin") {
    // macOS: brew がある場合は利用者に選ばせる（対話時のみ。非対話はネイティブ既定）。
    let useBrew = false;
    const brewAvail = commandWorks("brew");
    if (brewAvail && process.stdin.isTTY) {
      const asker = makeAsker();
      try {
        const ans = await asker.ask(
          "  インストール方法を選択してください [1] Homebrew / [2] 公式ネイティブ（Enter で 2）: "
        );
        useBrew = String(ans || "").trim() === "1";
      } finally {
        asker.close();
      }
    } else if (brewAvail) {
      process.stdout.write("  （非対話のため公式ネイティブインストーラーを使用します）\n");
    } else {
      process.stdout.write("  （Homebrew 未導入のため公式ネイティブインストーラーを使用します）\n");
    }
    if (useBrew) attempts.push({ name: "Homebrew", run: installBrew });
    attempts.push({ name: "公式ネイティブ", run: installNative });
  } else {
    // Windows / Linux: 公式ネイティブを第一候補。
    attempts.push({ name: "公式ネイティブ", run: installNative });
  }
  // 最終フォールバック: npm（ランチャーが Node の存在を保証済み）。
  if (commandWorks("npm")) attempts.push({ name: "npm", run: installNpm });

  for (const a of attempts) {
    process.stdout.write(`[bootstrap]   → ${a.name} でインストール中 …\n`);
    let r = null;
    try {
      r = a.run();
    } catch (e) {
      warn(`${a.name} の起動に失敗しました。${String((e && e.message) || e)}`);
    }
    if (r && r.status === 0) {
      process.stdout.write(`[bootstrap]   ✓ ${a.name} でインストールが完了しました。\n`);
      return { ok: true, method: a.name };
    }
    warn(`${a.name} でのインストールに失敗しました。次の手段を試します。`);
  }
  return { ok: false };
}

// インストール先 bin を利用者 PATH に通す（best-effort・冪等・安全）。
// ネイティブインストーラーは自動で PATH を通すため大半は no-op。npm 等の保険。
// 返り値で「変更したか / 既に通っていたか / 対象ディレクトリ」を呼び出し側へ返す。
function ensureClaudeOnPath() {
  const dir = claudeBinDir();
  try {
    if (!fs.existsSync(dir)) return { changed: false, onPath: isOnPath(dir), dir };
    if (isOnPath(dir)) return { changed: false, onPath: true, dir };

    if (IS_WIN) {
      // User スコープの PATH に冪等追加。setx は 1024 字で切り詰めるため PowerShell で安全に編集。
      const psDir = dir.replace(/'/g, "''");
      const ps = [
        `$d=[Environment]::GetEnvironmentVariable('Path','User');`,
        `$p='${psDir}';`,
        `if (-not ($d -split ';' | Where-Object { $_ -ieq $p })) {`,
        `  $nd = if ([string]::IsNullOrEmpty($d)) { $p } else { $d.TrimEnd(';') + ';' + $p };`,
        `  [Environment]::SetEnvironmentVariable('Path', $nd, 'User')`,
        `}`,
      ].join(" ");
      const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
        stdio: "ignore",
      });
      return { changed: !!(r && r.status === 0), onPath: false, dir };
    }

    // POSIX: ログインシェルの rc に export を冪等追記（既に .local/bin 記述があれば触らない）。
    const rc = posixRcFile();
    const cur = safeRead(rc);
    if (/\.local\/bin/.test(cur)) return { changed: false, onPath: false, dir };
    const prefix = cur === "" || cur.endsWith("\n") ? cur : cur + "\n";
    const body = prefix + '\n# Added by Belta installer — Claude CLI\nexport PATH="$HOME/.local/bin:$PATH"\n';
    atomicWrite(rc, body);
    return { changed: true, onPath: false, dir };
  } catch (e) {
    warn(`PATH への追加に失敗しました（手動で ${dir} を PATH に追加してください）。${String((e && e.message) || e)}`);
    return { changed: false, onPath: isOnPath(dir), dir };
  }
}

// PATH を通す対象のシェル rc を選ぶ（macOS 既定 zsh / Linux 既定 bash。存在優先、無ければ既定を新規）。
function posixRcFile() {
  const home = homeDir();
  const candidates =
    process.platform === "darwin"
      ? [".zshrc", ".zprofile", ".bash_profile", ".profile"]
      : [".bashrc", ".profile"];
  for (const c of candidates) {
    const p = path.join(home, c);
    if (fs.existsSync(p)) return p;
  }
  return path.join(home, process.platform === "darwin" ? ".zshrc" : ".bashrc");
}

// 次にユーザーがやるべき操作の案内。/workflow-setup は利用者自身に実行してもらう。
// opts.claudeInstallFailed 時は claude CLI の手動導入コマンドも併記する。
function printNextSteps(folder, pluginInstalled, opts) {
  const o = opts || {};
  const bar = "============================================================";
  const lines = [
    "",
    bar,
    "  ✅ インストールが完了しました",
    bar,
    "",
    "  次は、作成したフォルダ配下で Claude を起動し、",
    "  セットアップコマンドを実行してください。",
    "",
    "  ① 専用フォルダに移動して Claude Code を起動:",
    "",
    `       cd "${folder}"`,
    "       claude",
    "",
    "  ② 起動した Claude で、次のコマンドを入力:",
    "",
    "       /workflow-setup",
    "",
    "  → プロフィール登録と 4 アプリ（Notion / Slack / Google Drive /",
    "     GitHub）の接続（OAuth）が始まります。",
    "",
  ];
  if (!pluginInstalled) {
    lines.push(
      "  ※ claude コマンドが見つからなかったため、プラグインの自動インストールは",
      "     行っていません。上記①でフォルダを開くと自動で取り込まれます。",
      ""
    );
  }
  if (o.claudeInstallFailed) {
    lines.push(
      "  ※ Claude Code CLI の自動インストールに失敗しました。お手数ですが、",
      "     次のいずれかで手動導入してください（導入後に新しいターミナルで再実行）:",
      ""
    );
    if (IS_WIN) {
      lines.push(
        "       PowerShell:  irm https://claude.ai/install.ps1 | iex",
        "       または npm:  npm install -g @anthropic-ai/claude-code",
        ""
      );
    } else if (process.platform === "darwin") {
      lines.push(
        "       公式:        curl -fsSL https://claude.ai/install.sh | bash",
        "       Homebrew:    brew install --cask claude-code",
        "       または npm:  npm install -g @anthropic-ai/claude-code",
        ""
      );
    } else {
      lines.push(
        "       公式:        curl -fsSL https://claude.ai/install.sh | bash",
        "       または npm:  npm install -g @anthropic-ai/claude-code",
        ""
      );
    }
  }
  lines.push(
    "  ※ Claude Code（Max / Team / Enterprise プラン）が未導入の場合は、",
    "     先に導入してください。",
    bar,
    ""
  );
  process.stdout.write(lines.join("\n"));
}

// claude CLI を自動インストールした直後の案内。
// 同一プロセスでは追加された PATH が反映されないため、ターミナル再起動を促す（再起動は案内のみ）。
function printClaudeInstalledNextSteps(folder, method, pathInfo) {
  const bar = "============================================================";
  const lines = [
    "",
    bar,
    "  ✅ Claude Code CLI をインストールしました",
    bar,
    "",
    `  インストール方法: ${method}`,
  ];
  if (pathInfo && pathInfo.changed) {
    lines.push(`  PATH に追加しました: ${pathInfo.dir}`);
  } else if (pathInfo && pathInfo.onPath) {
    lines.push(`  PATH 設定済み: ${pathInfo.dir}`);
  }
  lines.push(
    "",
    "  ⚠ いま開いているこのウィンドウには、追加された PATH がまだ反映されません。",
    "     お手数ですが、ターミナル（コマンドプロンプト）をいったん閉じて、",
    "     新しく開き直してください（＝再起動）。",
    "",
    "  再起動したら、次のいずれかを実行してください。",
    "",
    "  ▸ かんたん（推奨）: このインストーラーをもう一度ダブルクリック／再実行する",
    "     → 今度は claude が見つかり、プラグインの取り込みまで自動で進みます。",
    "",
    "  ▸ または手動で:",
    "",
    `       cd "${folder}"`,
    "       claude",
    "       （起動した Claude で） /workflow-setup",
    "",
    "  ※ うまく見つからないときは、新しいターミナルで `claude --version` を実行し、",
    "     バージョンが表示されるか確認してください。",
    bar,
    ""
  );
  process.stdout.write(lines.join("\n"));
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

  // (1) 専用フォルダ + ~/.belta 最小初期化（共通の下ごしらえ）
  process.stdout.write("[bootstrap] (1) 専用フォルダ + ~/.belta 初期化 …\n");
  try {
    writeGitignore(folder);
    initBelta(email, folder);
  } catch (e) {
    warn(`下ごしらえの一部に失敗しました（継続します）。${String((e && e.message) || e)}`);
  }

  // (2) プラグイン導入：claude CLI があれば実インストール、無ければ自動導入 → 再起動案内
  const claudeBin = noClaude ? null : findClaude();

  // (2-a) claude CLI が不在 → 公式インストーラーで自動導入を試みる（--no-claude / --dry-run は除く）
  if (!claudeBin && !noClaude) {
    if (dryRun) {
      process.stdout.write(
        "[bootstrap] (2) （--dry-run）claude CLI 不在を検知。自動インストールを試行予定" +
          "（公式ネイティブ → npm、macOS は Homebrew 選択可）。\n"
      );
      try {
        writeSettings(folder);
      } catch {
        /* best-effort */
      }
      printNextSteps(folder, false);
      process.exit(0);
    }

    process.stdout.write("[bootstrap] (2) claude CLI を自動インストール …\n");
    const result = await installClaude();

    if (result && result.ok) {
      // インストール先 bin を PATH に通す（best-effort・冪等）。
      const pathInfo = ensureClaudeOnPath();
      // 同一プロセスでは PATH 未反映のため、プラグイン導入はせず宣言的に settings を書いて再起動案内。
      try {
        writeSettings(folder);
      } catch (e) {
        warn(`settings.local.json の生成に失敗しました（継続）。${String((e && e.message) || e)}`);
      }
      printClaudeInstalledNextSteps(folder, result.method, pathInfo);
      process.exit(0);
    }

    // 自動インストール失敗 → 宣言的フォールバック ＋ 手動導入案内。
    warn("claude CLI の自動インストールに失敗しました。設定を宣言的に書いて手動導入をご案内します。");
    try {
      writeSettings(folder);
    } catch {
      /* best-effort */
    }
    printNextSteps(folder, false, { claudeInstallFailed: true });
    process.exit(0);
  }

  // (2-b) --no-claude 明示時：claude を使わず宣言的に設定を書くだけ
  if (!claudeBin) {
    process.stdout.write(
      "[bootstrap] (2) プラグイン有効化設定を記述（--no-claude）…\n"
    );
    let settingsPath;
    try {
      settingsPath = writeSettings(folder);
    } catch (e) {
      fail(`settings.local.json の生成に失敗しました。${String((e && e.message) || e)}`);
    }
    process.stdout.write(`        → ${settingsPath}\n`);
    printNextSteps(folder, false);
    process.exit(0);
  }

  process.stdout.write("[bootstrap] (2) claude CLI でプラグインをインストール …\n");
  const mpArgs = ["plugin", "marketplace", "add", repo, "--scope", "local"];
  const instArgs = ["plugin", "install", `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, "--scope", "local"];

  if (dryRun) {
    process.stdout.write(`        （--dry-run）${folder} で次を実行予定:\n`);
    process.stdout.write(`          claude ${mpArgs.join(" ")}\n`);
    process.stdout.write(`          claude ${instArgs.join(" ")}\n`);
    process.exit(0);
  }

  // marketplace 登録（既存なら失敗しうるが致命ではない＝警告のみで継続）
  const mp = runClaude(mpArgs, folder, "inherit");
  if (!mp || mp.status !== 0) {
    warn("marketplace の追加に失敗（既に追加済みの可能性）。インストールを試行します。");
  }
  // 実インストール（必須）。失敗したら宣言的フォールバックへ。
  const inst = runClaude(instArgs, folder, "inherit");
  if (!inst || inst.status !== 0) {
    warn("プラグインの自動インストールに失敗しました。settings を宣言的に書いて手動案内へ切り替えます。");
    try {
      writeSettings(folder);
    } catch {
      /* best-effort */
    }
    printNextSteps(folder, false);
    process.exit(0);
  }
  process.stdout.write("        → プラグインのインストール完了。\n");

  // セットアップ（/workflow-setup）は利用者自身に実行してもらう（案内のみ）。
  printNextSteps(folder, true);
  process.exit(0);
})().catch((e) => {
  fail(String((e && e.message) || e));
});
