#!/usr/bin/env node
//
// Belta workflow plugin — ~/.belta/ 初期化 + config.yaml 管理（Day 8）
//
// ホーム配下の個人データ領域 `~/.belta/` を初期化し、機械可読設定 `config.yaml` を
// atomic write + 0o600（POSIX）で管理する。gstack-main の config.ts のパターン
// （mkdir recursive / tmp→rename の atomic write / 0o600 perms）を最小移植したもの。
//
// 使い方:
//   node belta-init.js [init]                         初期化（既定動作）
//   node belta-init.js init --owner-email a@b.jp --confidentiality 社外秘
//   node belta-init.js init --agent-home <専用フォルダの絶対パス>
//   node belta-init.js get <key>                      config.yaml の値を出力
//   node belta-init.js set <key> <value>              config.yaml の値を更新
//   共通オプション: --dir <path>（.belta のベースを上書き。既定は <home>/.belta）
//
// 設計（クロスプラットフォーム規約）:
//   - シェル非依存の Node.js のみ。パスは path API で連結。ホームは環境変数から解決。
//   - YAML は外部依存を避けるため、フラット（ネスト無し）スキーマ専用の最小実装。
//   - 0o600 は POSIX で有効、Windows では実質 no-op。権限に依存せず .belta は .gitignore
//     で除外し、機密の主防御は別層（OS / claude.ai 保管庫）に置く。
//   - 冪等: 既存ディレクトリ・既存 config 値は壊さない（init は欠けているものだけ補う）。

const fs = require("fs");
const path = require("path");
const os = require("os");

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let command = "init";
let dirOverride = null;
let ownerEmail = null;
let confidentiality = null;
let agentHome = null;
const positional = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--dir") dirOverride = argv[++i];
  else if (a === "--owner-email") ownerEmail = argv[++i];
  else if (a === "--confidentiality") confidentiality = argv[++i];
  else if (a === "--agent-home") agentHome = argv[++i];
  else if (a === "get" || a === "set" || a === "init") command = a;
  else positional.push(a);
}

// ---- パス解決 ----------------------------------------------------------------
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}
const beltaDir = dirOverride || path.join(homeDir(), ".belta");
const configPath = path.join(beltaDir, "config.yaml");

// ---- フラット YAML（ネスト無し）---------------------------------------------
// 値はすべてスカラ。true/false と整数はそのまま、それ以外は二重引用符で囲む。
function serialize(map, order) {
  const keys = order.filter((k) => k in map).concat(Object.keys(map).filter((k) => !order.includes(k)));
  const lines = ["# Belta config（machine-readable）。手で編集するより belta-init.js set を推奨。"];
  for (const k of keys) {
    lines.push(`${k}: ${formatValue(map[k])}`);
  }
  return lines.join("\n") + "\n";
}
function formatValue(v) {
  const s = String(v);
  if (s === "true" || s === "false") return s;
  if (/^-?\d+$/.test(s)) return s;
  // 二重引用符内をエスケープ
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function parse(text) {
  const map = {};
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

const CONFIG_ORDER = [
  "version",
  "created_at",
  "owner_email",
  "confidentiality",
  "agent_home",
  "feature_rule_learning",
  "feature_agent_learning",
  "feature_skill_suggestion",
  "feature_scheduler",
  "feature_user_model",
  "feature_hallucination_memory",
  "feature_avatar",
  "feature_avatar_publish",
  "insights_default_days",
  "notes_retention_days",
  "token_5h_warn",
];

function readConfig() {
  try {
    return parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

// atomic write: tmp に書いて rename。0o600（POSIX）。
function writeConfig(map) {
  fs.mkdirSync(beltaDir, { recursive: true });
  const tmp = configPath + ".tmp";
  fs.writeFileSync(tmp, serialize(map, CONFIG_ORDER), { mode: 0o600 });
  fs.renameSync(tmp, configPath);
  try {
    fs.chmodSync(configPath, 0o600); // 既存ファイル上書き時の保険（Windows では no-op 相当）
  } catch {
    /* Windows 等で失敗しても致命ではない */
  }
}

// ---- コマンド ----------------------------------------------------------------
function nowIso() {
  return new Date().toISOString();
}

function doInit() {
  // ディレクトリ生成（.belta 本体 0o700、サブは notes/inbox/todos）
  fs.mkdirSync(beltaDir, { recursive: true, mode: 0o700 });
  for (const sub of ["notes", "inbox", "todos", "memory"]) {
    fs.mkdirSync(path.join(beltaDir, sub), { recursive: true, mode: 0o700 });
  }

  // config.yaml：欠けている既定のみ補い、既存値は保持
  const existing = readConfig() || {};
  const merged = {
    version: existing.version || "1",
    created_at: existing.created_at || nowIso(),
    owner_email: existing.owner_email || "",
    confidentiality: existing.confidentiality || "",
    // 本プラグインを有効化した専用フォルダ（~/my-agent[-N]）の絶対パス。
    // setup-agent-home.js が決めた値を /workflow-setup が渡す。ホーム側の安定アンカー。
    agent_home: existing.agent_home || "",
    feature_rule_learning: existing.feature_rule_learning || "true",
    feature_agent_learning: existing.feature_agent_learning || "true",
    feature_skill_suggestion: existing.feature_skill_suggestion || "true",
    // 定期実行（scheduler スキル）と暗黙ユーザーモデル深化（user-model スキル）の有効化フラグ。
    feature_scheduler: existing.feature_scheduler || "true",
    feature_user_model: existing.feature_user_model || "true",
    // 事実訂正メモリ（hallucination-memory スキル）の有効化フラグ。
    feature_hallucination_memory: existing.feature_hallucination_memory || "true",
    // 育成アバター（avatar スキル）の有効化フラグ。集計・ダッシュボード生成は決定的。
    feature_avatar: existing.feature_avatar || "true",
    // アバター数値の GitHub Pages 公開。機密配慮で既定オフ（明示有効化が必要）。
    feature_avatar_publish: existing.feature_avatar_publish || "false",
    // /insights の既定走査日数（insights スキルが get で参照。未設定時は 7 にフォールバック）。
    insights_default_days: existing.insights_default_days || "7",
    // notes 日次ログの保持日数（notes-record.js の retention が参照）。
    // 既定 14。agent-learning の「直近 5 営業日」窓を週末込みで割らないため 7 より長め。
    notes_retention_days: existing.notes_retention_days || "14",
    // 直近 5 時間のトークン消費（利用制限カウント相当の推計）の警告しきい値。
    // 超えると session-start.js / repeat-detect.js が警告を注入する。0 で警告オフ。
    // 既定 70000 は Max 5x プランの 5 時間枠の目安（~88k）の約 8 割。
    token_5h_warn: existing.token_5h_warn || "70000",
  };
  // 余分な既存キーも保持
  for (const k of Object.keys(existing)) if (!(k in merged)) merged[k] = existing[k];

  // オンボーディング提供値で上書き（権威値）
  if (ownerEmail) merged.owner_email = ownerEmail;
  if (confidentiality) merged.confidentiality = confidentiality;
  if (agentHome) merged.agent_home = agentHome;

  writeConfig(merged);

  console.log(`[belta-init] 初期化完了: ${beltaDir}`);
  console.log(`  dirs: notes/ inbox/ todos/`);
  console.log(`  config: ${configPath}`);
  if (ownerEmail) console.log(`  owner_email = ${ownerEmail}`);
  if (confidentiality) console.log(`  confidentiality = ${confidentiality}`);
  if (agentHome) console.log(`  agent_home = ${agentHome}`);
}

function doGet() {
  const key = positional[0];
  if (!key) {
    console.error("[belta-init] get には key が必要です");
    process.exit(1);
  }
  const cfg = readConfig();
  if (!cfg || !(key in cfg)) {
    process.exit(1); // 未設定は exit 1（値は出さない）
  }
  console.log(cfg[key]);
}

function doSet() {
  const key = positional[0];
  const value = positional[1];
  if (!key || value === undefined) {
    console.error("[belta-init] set には key と value が必要です");
    process.exit(1);
  }
  const cfg = readConfig() || {};
  cfg[key] = value;
  if (!cfg.version) cfg.version = "1";
  if (!cfg.created_at) cfg.created_at = nowIso();
  writeConfig(cfg);
  console.log(`[belta-init] set ${key} = ${value}`);
}

switch (command) {
  case "get":
    doGet();
    break;
  case "set":
    doSet();
    break;
  case "init":
  default:
    doInit();
    break;
}
