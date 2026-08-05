#!/usr/bin/env node
//
// BELTA workflow plugin — プラグイン更新の確認と適用（plugin-update スキルの決定的エンジン）
//
// なぜ必要か:
//   settings.json の `extraKnownMarketplaces.<name>.autoUpdate: true` は Claude Code の
//   既知バグ（anthropics/claude-code#52218 / #17361）で機能せず、利用者の手元は古い
//   バージョンのまま残る（v0.5.3 配布時に実証）。`hooks/session-start.js` の (E) は
//   「更新が**適用された後**」の通知なので、「更新が**利用可能**」の検知手段が無かった。
//   このスクリプトがその穴を埋める（検知＝決定的スクリプト、提案・判断＝LLM スキル）。
//
// 使い方:
//   node scripts/update-check.js [--json]                 … 確認のみ（既定・読み取り専用）
//   node scripts/update-check.js --apply                  … 更新を適用（2 コマンド代行）
//   [--marketplace <name>] [--repo <owner/repo>] [--ref <branch>]
//   [--agent-home <path>]        … 適用先の専用フォルダを明示（既定は config.yaml の agent_home）
//   [--remote-version <v>]       … リモート値を注入（ネットワーク無しの分岐テスト用）
//
// 出力（常に JSON 1 個を stdout）:
//   確認: { ok, installed, latest, update_available, marketplace, plugin_key, repo,
//           agent_home, source, apply_hint, manual_commands }
//   適用: { ok, steps: [{ step, command, ok, output|error }], failed_step, restart_required,
//           manual_commands }
//
// 設計（クロスプラットフォーム規約）:
//   - シェル非依存。`cd A && B` を使わず execFileSync の cwd で作業フォルダを指定する。
//   - パスは path API、ホームは環境変数から解決。
//   - fail-open: 例外でも exit 0 + `ok:false` を返し、呼び出し側（LLM）に判断させる。
//     更新チェックの失敗でセッションや業務を止めない。

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { execFileSync } = require("child_process");

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let apply = false;
let marketplaceOverride = null;
let repoOverride = null;
let refOverride = null;
let agentHomeOverride = null;
let remoteVersionOverride = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--apply") apply = true;
  else if (a === "--marketplace") marketplaceOverride = argv[++i];
  else if (a === "--repo") repoOverride = argv[++i];
  else if (a === "--ref") refOverride = argv[++i];
  else if (a === "--agent-home") agentHomeOverride = argv[++i];
  else if (a === "--remote-version") remoteVersionOverride = argv[++i];
  // --json は既定で JSON 出力なので受け取るだけ（呼び出し側の意図を壊さない）
}

// ---- 基本ヘルパー（他スクリプトと同一の解決規則）-----------------------------
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

function installedVersion() {
  const manifest = readJson(path.join(pluginRoot(), ".claude-plugin", "plugin.json"));
  return (manifest && manifest.version) || "";
}

// pluginRoot から上位へ `.claude-plugin/marketplace.json` を探索（**dev リポジトリ専用**）。
// 罠: 配布インストールの実体は `<config>/plugins/cache/<marketplace>/<plugin>/<version>/` に
//     展開され、この階層には親方向のどこにも marketplace.json が無い。よって配布環境では
//     この関数は必ず null を返す（＝これ単独に頼ると常に marketplace_unresolved になる）。
//     配布環境は resolveFromInstalledPlugins / marketplaceFromCachePath で解決する。
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

// Claude Code の設定ディレクトリ（既定 `<home>/.claude`、CLAUDE_CONFIG_DIR で移設可）。
function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(homeDir(), ".claude");
}

function pluginsDir() {
  return path.join(claudeConfigDir(), "plugins");
}

// パス比較の正規化（symlink・大文字小文字・末尾区切りの差を吸収）。
function canonPath(p) {
  if (!p) return "";
  let s = path.resolve(String(p));
  try {
    s = fs.realpathSync(s);
  } catch {
    /* 実体が無くても resolve 済みの文字列で比較する */
  }
  s = s.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? s.toLowerCase() : s;
}

// ① installed_plugins.json から marketplace 名を引く（最も確実）。
//    キーが `<plugin>@<marketplace>` 形式で、値の installPath が pluginRoot と一致する。
function resolveFromInstalledPlugins(root, name) {
  const data = readJson(path.join(pluginsDir(), "installed_plugins.json"));
  const plugins = data && data.plugins;
  if (!plugins || typeof plugins !== "object") return null;

  const target = canonPath(root);
  let byNameOnly = null; // installPath 不一致でも名前一致は保険として拾う

  for (const key of Object.keys(plugins)) {
    const at = key.lastIndexOf("@");
    if (at <= 0) continue;
    if (key.slice(0, at) !== name) continue;
    const mp = key.slice(at + 1);
    if (!mp) continue;
    if (!byNameOnly) byNameOnly = mp;

    const entries = Array.isArray(plugins[key]) ? plugins[key] : [];
    for (const e of entries) {
      if (e && e.installPath && canonPath(e.installPath) === target) return mp;
    }
  }
  return byNameOnly;
}

// ② キャッシュのパス構造から marketplace 名を導出（installed_plugins.json が壊れている保険）。
//    `<...>/plugins/cache/<marketplace>/<plugin>/<version>` の並びを探す。
function marketplaceFromCachePath(root, name) {
  const parts = path.resolve(root).split(/[\\/]+/).filter(Boolean);
  for (let i = 0; i + 3 < parts.length; i++) {
    if (parts[i] !== "plugins" || parts[i + 1] !== "cache") continue;
    if (parts[i + 3] !== name) continue;
    return parts[i + 2];
  }
  return null;
}

// marketplace 名 → repo。ローカルクローンの marketplace.json →
// known_marketplaces.json の source の順で引く。
function repoForMarketplace(marketplaceName, name) {
  if (!marketplaceName) return null;

  const clone = path.join(pluginsDir(), "marketplaces", marketplaceName, ".claude-plugin", "marketplace.json");
  const mp = readJson(clone);
  if (mp) {
    const entry = Array.isArray(mp.plugins) ? mp.plugins.find((p) => p && p.name === name) : null;
    const r = parseRepo(entry && entry.repository) || parseRepo(mp.repository);
    if (r) return r;
  }

  const known = readJson(path.join(pluginsDir(), "known_marketplaces.json"));
  const src = known && known[marketplaceName] && known[marketplaceName].source;
  if (src) return parseRepo(src.repo) || parseRepo(src.url);
  return null;
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

// config.yaml（フラット YAML）から 1 キー読む（belta-init.js と同形式）。
function readConfigValue(key) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(homeDir(), ".belta", "config.yaml"), "utf8");
  } catch {
    return "";
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    if (line.slice(0, idx).trim() !== key) continue;
    let val = line.slice(idx + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    return val;
  }
  return "";
}

// "a.b.c" のセマンティックバージョン比較（session-start.js と同じ安全側の扱い）。
// a>b で 1、a<b で -1、等しければ 0。数値化できない要素は 0 扱い。
function compareVersions(a, b) {
  const pa = String(a || "").split(".");
  const pb = String(b || "").split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i], 10);
    const nb = parseInt(pb[i], 10);
    const va = Number.isFinite(na) ? na : 0;
    const vb = Number.isFinite(nb) ? nb : 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
  process.exit(0); // 常に 0（fail-open。判断は呼び出し側に委ねる）
}

// ---- marketplace 名 / repo の決定 --------------------------------------------
// 解決順: 明示指定 → dev リポジトリの marketplace.json → installed_plugins.json →
//         キャッシュのパス構造。repo はローカルクローン / known_marketplaces.json で補う。
function resolveIdentity() {
  let marketplaceName = marketplaceOverride;
  let repo = repoOverride ? parseRepo(repoOverride) : null;
  const name = pluginName();
  const root = pluginRoot();
  const resolvedVia = [];

  if (marketplaceName) resolvedVia.push("option");

  // (a) dev リポジトリ（上位に marketplace.json がある場合のみ）
  if (!marketplaceName || !repo) {
    const mpPath = findMarketplaceJson(root);
    const mp = mpPath ? readJson(mpPath) : null;
    if (mp) {
      if (!marketplaceName && mp.name) {
        marketplaceName = mp.name;
        resolvedVia.push("repo-marketplace.json");
      }
      if (!repo) {
        const entry = Array.isArray(mp.plugins) ? mp.plugins.find((p) => p && p.name === name) : null;
        repo = parseRepo(entry && entry.repository) || parseRepo(mp.repository);
      }
    }
  }

  // (b) 配布インストール: installed_plugins.json のキー `<plugin>@<marketplace>`
  if (!marketplaceName) {
    const mpName = resolveFromInstalledPlugins(root, name);
    if (mpName) {
      marketplaceName = mpName;
      resolvedVia.push("installed_plugins.json");
    }
  }

  // (c) 配布インストール: キャッシュのパス構造
  if (!marketplaceName) {
    const mpName = marketplaceFromCachePath(root, name);
    if (mpName) {
      marketplaceName = mpName;
      resolvedVia.push("cache-path");
    }
  }

  // repo を marketplace 名から補完（ローカルクローン → known_marketplaces.json）
  if (!repo && marketplaceName) {
    repo = repoForMarketplace(marketplaceName, name);
    if (repo) resolvedVia.push("marketplace-registry");
  }

  return { marketplaceName, repo, name, resolvedVia };
}

// ---- リモート最新バージョンの取得（2 段フォールバック）------------------------
// ① gh api（OAuth 済み・permissions の `gh api * --method GET*` で allow 済み。private repo でも通る）
// ② https で raw.githubusercontent.com（gh 未導入環境の保険）
function fetchRemoteMarketplace(repo, ref) {
  const branch = ref || "main";

  // ① gh api（raw アクセプトヘッダでファイル本文をそのまま取得）
  try {
    const out = execFileSync(
      "gh",
      [
        "api",
        `repos/${repo}/contents/.claude-plugin/marketplace.json?ref=${branch}`,
        "--method",
        "GET",
        "-H",
        "Accept: application/vnd.github.raw",
      ],
      { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] }
    );
    const json = JSON.parse(out);
    return { json, source: "gh api" };
  } catch {
    /* gh 未導入 / 未認証 / ネットワーク不通 → ② へ */
  }

  // ② raw.githubusercontent.com（同期的に待つため deasync 相当は使わず、子プロセスの
  //    node -e ではなく https + 同期待ちが必要になるので、ここは execFileSync で
  //    自プロセスを使わず curl 相当を避け、Node の https を Promise で扱う。
  //    呼び出し側は await できないため、同期化のために子 node プロセスへ委譲する。
  try {
    const script =
      "const https=require('https');" +
      "https.get(process.argv[1],{headers:{'User-Agent':'belta-update-check'}},r=>{" +
      "if(r.statusCode!==200){process.exit(1);}" +
      "let d='';r.on('data',c=>d+=c);r.on('end',()=>{process.stdout.write(d);});" +
      "}).on('error',()=>process.exit(1)).setTimeout(4000,function(){this.destroy();process.exit(1);});";
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/.claude-plugin/marketplace.json`;
    const out = execFileSync(process.execPath, ["-e", script, url], {
      encoding: "utf8",
      timeout: 6000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const json = JSON.parse(out);
    return { json, source: "raw.githubusercontent.com" };
  } catch {
    return { json: null, source: null };
  }
}

function latestFromMarketplace(mp, name) {
  if (!mp) return "";
  const entry = Array.isArray(mp.plugins) ? mp.plugins.find((p) => p && p.name === name) : null;
  return (entry && entry.version) || "";
}

// ---- 適用（2 コマンド代行）----------------------------------------------------
// 罠（実証済み）:
//   - `claude plugin install` は既インストール時「already installed」で何もしない
//     → 更新には install ではなく update を使う。
//   - `claude plugin update` は `--scope local` 必須（本プラグインはローカルスコープ運用。
//     既定の user スコープでは "not installed at scope user" で失敗する）。
//   - 専用フォルダで実行する必要があるので、`cd` ではなく execFileSync の cwd で指定する。
function runApply(marketplaceName, pluginKey, agentHome) {
  const steps = [];
  let failedStep = null;

  function run(step, args, cwd) {
    const command = "claude " + args.join(" ");
    try {
      const output = execFileSync("claude", args, {
        encoding: "utf8",
        timeout: 60000,
        cwd: cwd || undefined,
        stdio: ["ignore", "pipe", "pipe"],
      });
      steps.push({ step, command, cwd: cwd || null, ok: true, output: String(output).trim().slice(0, 2000) });
      return true;
    } catch (e) {
      const detail = [e && e.stderr, e && e.stdout, e && e.message]
        .filter(Boolean)
        .map(String)
        .join("\n")
        .trim()
        .slice(0, 2000);
      steps.push({ step, command, cwd: cwd || null, ok: false, error: detail });
      failedStep = step;
      return false;
    }
  }

  // Step 1: marketplace のクローン / キャッシュを最新化
  const ok1 = run("marketplace-update", ["plugin", "marketplace", "update", marketplaceName]);
  // Step 2: installed_plugins.json の参照を新バージョンへ切替（専用フォルダで local スコープ）
  //         Step 1 が失敗しても試す価値があるので続行する（キャッシュが既に新しい場合がある）。
  const ok2 = run("plugin-update", ["plugin", "update", pluginKey, "--scope", "local"], agentHome || undefined);

  return { steps, failedStep, allOk: ok1 && ok2, updatedOk: ok2 };
}

// ---- メイン ------------------------------------------------------------------
try {
  const { marketplaceName, repo, name, resolvedVia } = resolveIdentity();
  const installed = installedVersion();
  const agentHome = agentHomeOverride || readConfigValue("agent_home") || "";
  const pluginKey = marketplaceName ? `${name}@${marketplaceName}` : name;

  const manualCommands = [
    marketplaceName ? `claude plugin marketplace update ${marketplaceName}` : null,
    `claude plugin update ${pluginKey} --scope local`,
  ].filter(Boolean);

  if (!marketplaceName) {
    emit({
      ok: false,
      reason: "marketplace_unresolved",
      message:
        `marketplace 名を特定できませんでした（plugin "${name}" が dev リポジトリの marketplace.json・` +
        "installed_plugins.json・キャッシュのパス構造のいずれからも引けない）。" +
        "--marketplace <name> を指定するか、/plugin メニューから手動で更新してください。",
      installed,
      plugin_root: pluginRoot(),
      plugins_dir: pluginsDir(),
      manual_commands: manualCommands,
    });
  }

  // ---- 適用モード ----
  if (apply) {
    if (!agentHome) {
      emit({
        ok: false,
        reason: "agent_home_unresolved",
        message:
          "専用フォルダ（agent_home）が特定できませんでした。`claude plugin update` は " +
          "--scope local のため専用フォルダ内で実行する必要があります。" +
          "--agent-home <絶対パス> を指定するか、専用フォルダを開いて手動コマンドを実行してください。",
        plugin_key: pluginKey,
        marketplace: marketplaceName,
        manual_commands: manualCommands,
      });
    }
    if (!fs.existsSync(agentHome)) {
      emit({
        ok: false,
        reason: "agent_home_missing",
        message: `専用フォルダが存在しません: ${agentHome}（config.yaml の agent_home を確認してください）`,
        agent_home: agentHome,
        manual_commands: manualCommands,
      });
    }

    const r = runApply(marketplaceName, pluginKey, agentHome);
    emit({
      ok: r.updatedOk,
      mode: "apply",
      installed_before: installed,
      marketplace: marketplaceName,
      plugin_key: pluginKey,
      agent_home: agentHome,
      steps: r.steps,
      failed_step: r.failedStep,
      restart_required: r.updatedOk,
      message: r.updatedOk
        ? "更新を適用しました。反映には Claude Code の再起動（専用フォルダを開き直す）が必要です。"
        : "更新の適用に失敗しました。steps の error を確認し、manual_commands を手で実行してください。",
      manual_commands: manualCommands,
    });
  }

  // ---- 確認モード ----
  let latest = "";
  let source = "override";
  if (remoteVersionOverride != null) {
    latest = String(remoteVersionOverride);
  } else {
    if (!repo) {
      emit({
        ok: false,
        reason: "repo_unresolved",
        message:
          "GitHub リポジトリを特定できませんでした（marketplace.json の repository が無い）。" +
          "--repo <owner/repo> を指定するか、/plugin メニューから手動で確認してください。",
        installed,
        marketplace: marketplaceName,
        plugin_key: pluginKey,
        manual_commands: manualCommands,
      });
    }
    const fetched = fetchRemoteMarketplace(repo, refOverride);
    if (!fetched.json) {
      emit({
        ok: false,
        reason: "fetch_failed",
        message:
          "最新バージョンを取得できませんでした（ネットワーク不通・未認証・repo 非公開などの可能性）。" +
          "しばらく後に再試行するか、/plugin メニューから手動で確認してください。",
        installed,
        marketplace: marketplaceName,
        plugin_key: pluginKey,
        repo,
        manual_commands: manualCommands,
      });
    }
    latest = latestFromMarketplace(fetched.json, name);
    source = fetched.source;
  }

  if (!latest) {
    emit({
      ok: false,
      reason: "latest_unresolved",
      message: `リモートの marketplace.json に plugin "${name}" の version が見つかりませんでした。`,
      installed,
      marketplace: marketplaceName,
      plugin_key: pluginKey,
      repo,
      source,
      manual_commands: manualCommands,
    });
  }

  const cmp = compareVersions(latest, installed);
  emit({
    ok: true,
    mode: "check",
    installed,
    latest,
    // installed が latest より新しい場合（開発リポジトリで実行したとき等）は更新なし扱い
    update_available: cmp > 0,
    marketplace: marketplaceName,
    plugin_key: pluginKey,
    repo: repo || null,
    agent_home: agentHome || null,
    source,
    resolved_via: resolvedVia,
    apply_hint: `node "\${CLAUDE_PLUGIN_ROOT}/scripts/update-check.js" --apply`,
    manual_commands: manualCommands,
  });
} catch (e) {
  emit({
    ok: false,
    reason: "unexpected_error",
    message: String((e && e.message) || e),
  });
}
