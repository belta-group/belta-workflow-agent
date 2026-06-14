#!/usr/bin/env node
//
// BELTA workflow plugin — 使用状況の計測（UserPromptSubmit / PostToolUse）
//
// 育成ダッシュボードの「よく使うコマンド」「エージェント使用比率」を出すための
// 決定的な下支え。1 つのスクリプトを 2 イベントに登録し、stdin の hook_event_name
// で分岐して、それぞれ別ファイルに使用回数を加算する。
//   - UserPromptSubmit: 送信がスラッシュコマンドなら commands.json に加算。
//       生入力（先頭スラッシュ）と展開後本文（コマンド .md の H1 マーカー）の
//       両系統で検出し、環境差（ターミナル / Claude Desktop 等）を吸収する。
//   - PostToolUse(matcher Task): サブエージェント起動なら agents.json に加算。
//
// 二層分担（既存の notes-record.js / repeat-detect.js と同じ思想）:
//   決定的なカウントはこのフックが確定的に残し、意味判断・可視化は avatar スクリプト /
//   LLM に委ねる。LLM 任せの記録が漏れても回数が後退しないようにする下支え。
//
// 集計ファイル（いずれも <home>/.belta/audit/ 配下・累計）:
//   commands.json : { schema_version, updated, commands: { "/avatar": { count, last } } }
//   agents.json   : { schema_version, updated, total, agents: { "<name>": { count, last } } }
//
// 設計（cross-platform.md / フックの鉄則）:
//   - シェル非依存の Node.js。fs/path/os だけ。ホームは環境変数から解決。改行 /\r?\n/。
//   - atomic write（.tmp → rename）。1 イベント = 1 加算（二重計上しない）。
//   - fail-open: 何が起きてもプロンプト・ツール実行を決して妨げない。無出力で exit 0。
//
// 実機検証ゲート:
//   サブエージェント起動時に PostToolUse が tool_name:"Task" で発火し
//   tool_input.subagent_type を持つことは公式ドキュメントで完全には確証できない
//   （SubagentStart/Stop の可能性あり）。本フックはフィールドが取れなければ何もしない
//   （fail-open）。BELTA_USAGE_DEBUG=1 のとき受信 payload を audit/usage-debug.log へ
//   追記して実機のフィールド名を確認できるようにしてある。

const fs = require("fs");
const path = require("path");
const os = require("os");

const MAX_KEYS = 500; // 1 ファイルで保持するキー上限（暴走防止）

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function resolveHome() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(p, obj) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj), "utf8");
    fs.renameSync(tmp, p);
  } catch {
    /* 書けなくても致命でない（fail-open） */
  }
}

// オブジェクトのキー数を上限で丸める（古い last のものから捨てる）。
function capEntries(map) {
  const keys = Object.keys(map);
  if (keys.length <= MAX_KEYS) return map;
  keys
    .sort((a, b) => String(map[a] && map[a].last).localeCompare(String(map[b] && map[b].last)))
    .slice(0, keys.length - MAX_KEYS)
    .forEach((k) => delete map[k]);
  return map;
}

// ---- コマンド使用（UserPromptSubmit）----------------------------------------
function trackCommand(payload, auditDir) {
  const prompt = String(payload.prompt || "");
  const cmd = detectCommand(prompt);
  if (!cmd) return;
  bumpCounter(path.join(auditDir, "commands.json"), "commands", cmd);
}

// スラッシュコマンドを 2 系統で検出する（環境差を吸収）。
//   (1) 生入力: 先頭がスラッシュコマンド。展開前テキストが UserPromptSubmit に渡る
//       環境（ターミナル等）向け。
//   (2) 展開後本文: ハーネスがコマンド .md を展開した本文を UserPromptSubmit に渡す
//       環境（Claude Desktop 等。`UserPromptExpansion` 経路で展開される）向けの
//       フォールバック。本リポジトリの各コマンド .md は本文先頭付近に必ず
//       `# /<name> — …`（em-dash 区切り）の H1 を持つので、それを拾う。
//
// これが無いと、本文が `<!--` コメントで始まるコマンド（/avatar・/report 等）は
// 生入力正規表現 (1) にマッチせず一切記録されず、結果として相対的に /workflow へ
// 偏って見える（＝「avatar/report が workflow に合算」問題）。両系統で拾うことで
// どの環境でもコマンドごとに個別計上する。発火経路は環境ごとに一方のみなので
// 二重計上は起きない。
function detectCommand(prompt) {
  // (1) 生入力（先頭スラッシュ）。
  const direct = /^\s*\/([a-zA-Z][\w-]*)/.exec(prompt);
  if (direct) return "/" + direct[1].toLowerCase();
  // (2) 展開後本文の H1 マーカー。先頭付近のみ走査して誤検知を抑える。
  //     区切りは em-dash(—)/en-dash(–)/hyphen(-) のいずれも許容。
  const head = prompt.split(/\r?\n/, 60).join("\n");
  const heading = /^#[ \t]+\/([a-zA-Z][\w-]*)[ \t]+[—–-]/m.exec(head);
  if (heading) return "/" + heading[1].toLowerCase();
  return null;
}

// <auditDir>/<file> の mapKey 配下で name の count を +1（汎用。atomic・上限丸め・total 付き）。
function bumpCounter(file, mapKey, name) {
  const cur = readJson(file) || {};
  const map = cur[mapKey] && typeof cur[mapKey] === "object" ? cur[mapKey] : {};
  const entry = map[name] && typeof map[name] === "object" ? map[name] : { count: 0 };
  entry.count = (Number(entry.count) || 0) + 1;
  entry.last = nowIso();
  map[name] = entry;
  capEntries(map); // 上限超過時に古いものを間引く（今回分は last が最新なので残る）
  const total = Object.values(map).reduce((a, e) => a + (Number(e && e.count) || 0), 0);
  writeJsonAtomic(file, { schema_version: 1, updated: nowIso(), total, [mapKey]: map });
}

// ---- エージェント起動（PostToolUse: Task）-----------------------------------
function trackAgent(payload, auditDir) {
  const ti = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};
  // フィールド名は実装差を吸収（subagent_type が第一候補）。
  let name = ti.subagent_type || ti.subagentType || ti.agent_type || ti.agentType || "";
  name = String(name || "").trim();
  if (!name) return; // 取れなければ何もしない（fail-open / 実機検証ゲート）
  bumpCounter(path.join(auditDir, "agents.json"), "agents", name);
}

// ---- スキル発火（PostToolUse: Skill）----------------------------------------
function trackSkill(payload, auditDir) {
  const ti = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};
  // Skill ツールは skill 名を tool_input.skill で渡す（plugin:skill 形式もそのまま記録）。
  let name = ti.skill || ti.skill_name || ti.name || "";
  name = String(name || "").trim();
  if (!name) return;
  bumpCounter(path.join(auditDir, "skills.json"), "skills", name);
}

try {
  const raw = readStdin() || "{}";
  const payload = JSON.parse(raw);

  const home = resolveHome();
  if (!home) process.exit(0);
  const auditDir = path.join(home, ".belta", "audit");

  // 実機フィールド確認用（既定 OFF）。
  if (process.env.BELTA_USAGE_DEBUG === "1") {
    try {
      fs.mkdirSync(auditDir, { recursive: true });
      fs.appendFileSync(path.join(auditDir, "usage-debug.log"), nowIso() + " " + raw.replace(/\s+/g, " ").slice(0, 2000) + "\n");
    } catch {
      /* デバッグ失敗は無視 */
    }
  }

  const event = String(payload.hook_event_name || "");
  if (event === "UserPromptSubmit") {
    trackCommand(payload, auditDir);
  } else if (event === "PostToolUse") {
    // ツール名で振り分け（matcher 不適合な環境でも誤計上しない）。
    const tool = String(payload.tool_name || "");
    if (/(^|_)task$/i.test(tool) || /\btask\b/i.test(tool)) trackAgent(payload, auditDir);
    else if (/(^|_)skill$/i.test(tool) || /\bskill\b/i.test(tool)) trackSkill(payload, auditDir);
  }
  // 不明イベントは何もしない。
} catch {
  // fail-open: 何が起きてもプロンプト・ツールを妨げない。
}
process.exit(0);
