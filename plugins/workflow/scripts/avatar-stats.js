#!/usr/bin/env node
//
// Belta workflow plugin — 育成アバター 集計エンジン（決定的）
//
// `~/.belta/` 配下の活動データ（notes / audit/tokens / audit/repeat / rules /
// agents / skills / user-model / memory）を決定的に走査し、レベル・XP・6軸ステータス・
// 実績バッジ・連続稼働ストリーク・スキルツリーを計算して JSON で出力する。
// 自然文（成長日記）は insights スキル（LLM）が別途生成する。ここは数値のみ。
//
// 使い方:
//   node avatar-stats.js [--json|--md] [--dir <.beltaベース>] [--no-write]
//     --json     機械可読 JSON（既定）
//     --md       人間可読サマリ（会話表示用）
//     --dir      .belta のベースを上書き（既定 <home>/.belta）。テスト用
//     --no-write 永続台帳 history.json を更新しない（純粋な読み取り）
//
// import 利用:
//   const { computeStats } = require(".../avatar-stats.js");
//   const stats = computeStats({ dir, write: false });
//
// 設計（cross-platform.md / 既存フックの鉄則）:
//   - シェル非依存の Node.js のみ。fs/path/os だけ。ホームは環境変数から解決。改行 /\r?\n/。
//   - fail-open: 入力が無い/壊れていても落とさず、空でも成立する JSON を返し exit 0。
//   - notes は既定 14 日で剪定されるため、累積成長を守る軽量な永続台帳
//     <belta>/avatar/history.json に「稼働日・既知セッション」を union 追記する。
//     これで剪定後も sessions_total / active_days / streak が後退しない。

const fs = require("fs");
const path = require("path");
const os = require("os");

// 反復検知と同じ正規化・パーサを再利用（「同じ依頼」の判定基準を一元化）。
let repeatUtil;
try {
  repeatUtil = require(path.join(__dirname, "..", "hooks", "repeat-util.js"));
} catch {
  repeatUtil = { normalizeRequest: (s) => (typeof s === "string" ? s.trim().toLowerCase() : ""), parseNotesSessions: () => [] };
}
const { parseNotesSessions } = repeatUtil;

// ---- パス解決 ----------------------------------------------------------------
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}

// ---- 安全 I/O（すべて fail-open）---------------------------------------------
function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
function listFiles(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// ---- 日付ユーティリティ（UTC 基準・依存なし）---------------------------------
function todayStamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function dayDiff(a, b) {
  // a, b: "YYYY-MM-DD"。a - b の日数（UTC）。
  const am = Date.parse(`${a}T00:00:00Z`);
  const bm = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(am) || !Number.isFinite(bm)) return NaN;
  return Math.round((am - bm) / 86400000);
}

// ---- トークン集計（インライン：プラグイン境界を越えない）---------------------
function aggregateTokensInline(tokensDir) {
  const totals = {
    sessions: 0,
    turns: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    billable_token_estimate: 0,
  };
  const files = listFiles(tokensDir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  for (const f of files) {
    const rec = readJson(path.join(tokensDir, f));
    if (!rec || typeof rec !== "object" || !rec.usage) continue;
    totals.sessions++;
    totals.turns += Number(rec.turns) || 0;
    totals.input_tokens += Number(rec.usage.input_tokens) || 0;
    totals.output_tokens += Number(rec.usage.output_tokens) || 0;
    totals.cache_creation_input_tokens += Number(rec.usage.cache_creation_input_tokens) || 0;
    totals.cache_read_input_tokens += Number(rec.usage.cache_read_input_tokens) || 0;
    totals.billable_token_estimate += Number(rec.billable_token_estimate) || 0;
  }
  const denom = totals.cache_read_input_tokens + totals.cache_creation_input_tokens + totals.input_tokens;
  const cacheHitRatio = denom > 0 ? totals.cache_read_input_tokens / denom : 0;
  return { totals, cache_hit_ratio: Number(cacheHitRatio.toFixed(4)) };
}

// ---- notes 走査（稼働日・セッション・依頼・時刻帯・ツール分布）---------------
const TOOL_PATTERNS = {
  notion: /notion|ノーション|ノート|議事録|データベース|wiki/i,
  slack: /slack|スラック|チャンネル|dm|メンション|投稿/i,
  github: /github|ギットハブ|\bpr\b|プルリク|issue|イシュー|コミット|レビュー|リポジト/i,
  drive: /drive|ドライブ|スプレッド|スライド|ドキュメント|フォルダ|gdrive/i,
};

function scanNotes(notesDir) {
  const names = listFiles(notesDir);
  const dailyDates = [];
  const sessionRows = []; // {date, sessionId, requests}
  const hourCounts = { morning: 0, day: 0, evening: 0, night: 0 }; // 5-9 / 10-17 / 18-21 / 22-4
  const toolHits = { notion: 0, slack: 0, github: 0, drive: 0 };

  for (const name of names) {
    const md = /^(\d{4})-(\d{2})-(\d{2})\.md$/.exec(name);
    if (!md) continue;
    const date = `${md[1]}-${md[2]}-${md[3]}`;
    dailyDates.push(date);
    const text = readText(path.join(notesDir, name));
    // 時刻帯（"- HH:MM [session:..." 行頭）
    for (const rawLine of text.split(/\r?\n/)) {
      const tm = /^- (\d{2}):(\d{2}) \[session:/.exec(rawLine.trim());
      if (tm) {
        const h = parseInt(tm[1], 10);
        if (h >= 5 && h <= 9) hourCounts.morning++;
        else if (h >= 10 && h <= 17) hourCounts.day++;
        else if (h >= 18 && h <= 21) hourCounts.evening++;
        else hourCounts.night++;
      }
    }
    // セッション・依頼
    for (const r of parseNotesSessions(text)) {
      sessionRows.push({ date, sessionId: r.sessionId, requests: r.requests });
      const blob = r.requests.join(" ");
      for (const [tool, re] of Object.entries(TOOL_PATTERNS)) {
        if (re.test(blob)) toolHits[tool]++;
      }
    }
  }
  return { dailyDates, sessionRows, hourCounts, toolHits };
}

// ---- 永続台帳（剪定耐性）-----------------------------------------------------
// history.json: { schema_version, first_seen, active_days[], known_sessions[], sessions_total, requests_total, tool_totals{} }
const MAX_KNOWN_SESSIONS = 3000;

function loadHistory(avatarDir) {
  const h = readJson(path.join(avatarDir, "history.json"));
  if (h && typeof h === "object") {
    return {
      schema_version: 1,
      first_seen: h.first_seen || "",
      active_days: Array.isArray(h.active_days) ? h.active_days.slice() : [],
      known_sessions: Array.isArray(h.known_sessions) ? h.known_sessions.slice() : [],
      sessions_total: Number(h.sessions_total) || 0,
      requests_total: Number(h.requests_total) || 0,
      tool_totals: h.tool_totals && typeof h.tool_totals === "object" ? { ...h.tool_totals } : { notion: 0, slack: 0, github: 0, drive: 0 },
    };
  }
  return {
    schema_version: 1,
    first_seen: "",
    active_days: [],
    known_sessions: [],
    sessions_total: 0,
    requests_total: 0,
    tool_totals: { notion: 0, slack: 0, github: 0, drive: 0 },
  };
}

function updateHistory(history, notes) {
  // 稼働日を union
  const dateSet = new Set(history.active_days);
  for (const d of notes.dailyDates) dateSet.add(d);
  history.active_days = [...dateSet].sort();
  if (!history.first_seen) history.first_seen = history.active_days[0] || todayStamp();

  // 新規セッションを累積
  const known = new Set(history.known_sessions);
  for (const row of notes.sessionRows) {
    if (!known.has(row.sessionId)) {
      known.add(row.sessionId);
      history.sessions_total++;
      history.requests_total += row.requests.length;
    }
  }
  // ツール累積（visible セッションの hit を毎回そのまま足すと重複するので、
  // 累積はしない。代わりに「現在の visible 分布」をそのまま使い、tool_totals は
  // 過去最大値を保持する union 的扱いにする）。
  for (const k of Object.keys(history.tool_totals)) {
    history.tool_totals[k] = Math.max(Number(history.tool_totals[k]) || 0, notes.toolHits[k] || 0);
  }
  // known_sessions を上限で丸める（古いものから捨てる。sessions_total は減らさない）
  history.known_sessions = [...known].slice(-MAX_KNOWN_SESSIONS);
  return history;
}

function computeStreak(activeDays) {
  if (!activeDays.length) return { current: 0, max: 0 };
  const set = new Set(activeDays);
  // current: 今日 or 昨日から遡って連続する日数
  const today = todayStamp();
  let anchor = null;
  if (set.has(today)) anchor = today;
  else {
    // 昨日
    const y = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000);
    const p = (x) => String(x).padStart(2, "0");
    const yday = `${y.getUTCFullYear()}-${p(y.getUTCMonth() + 1)}-${p(y.getUTCDate())}`;
    if (set.has(yday)) anchor = yday;
  }
  let current = 0;
  if (anchor) {
    let cur = anchor;
    while (set.has(cur)) {
      current++;
      const prev = new Date(Date.parse(`${cur}T00:00:00Z`) - 86400000);
      const p = (x) => String(x).padStart(2, "0");
      cur = `${prev.getUTCFullYear()}-${p(prev.getUTCMonth() + 1)}-${p(prev.getUTCDate())}`;
    }
  }
  // max: ソート済み配列上の最長連続
  const sorted = [...set].sort();
  let max = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (dayDiff(sorted[i], sorted[i - 1]) === 1) run++;
    else run = 1;
    if (run > max) max = run;
  }
  return { current, max };
}

// ---- ルール / エージェント / スキル / モデル / メモリ ------------------------
function countRules(beltaDir) {
  const byType = { preference: 0, "mistake-fix": 0, workflow: 0, "domain-knowledge": 0, unknown: 0 };
  let total = 0;
  const rulesDir = path.join(beltaDir, "rules");
  const index = readText(path.join(rulesDir, "RULES.md"));
  // 索引行 "- [slug](slug.md) — desc" を数え、各 slug.md の frontmatter type を読む
  for (const line of index.split(/\r?\n/)) {
    const m = /^-\s*\[[^\]]+\]\(([^)]+\.md)\)/.exec(line.trim());
    if (!m) continue;
    total++;
    const slugFile = m[1];
    const fm = readText(path.join(rulesDir, slugFile));
    const tm = /^type:\s*(.+)$/m.exec(fm);
    const t = tm ? tm[1].trim() : "unknown";
    if (t in byType) byType[t]++;
    else byType.unknown++;
  }
  return { total, byType };
}

function countAgents(beltaDir) {
  const text = readText(path.join(beltaDir, "agents", "AGENTS.md"));
  let fired = 0;
  let adopted = 0;
  let deleted = 0;
  const adoptedNames = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!/^-\s*\[/.test(t)) continue;
    if (/fired:\s*\d{4}-\d{2}-\d{2}/.test(t)) fired++;
    const isAdopted = /adopted:\s*\d{4}-\d{2}-\d{2}/.test(t);
    if (isAdopted) adopted++;
    if (/deleted:\s*\d{4}-\d{2}-\d{2}/.test(t)) deleted++;
    // 索引のリンク表示名 "- [表示名](slug.md) …" を採用済み・未削除のものだけ拾う
    if (isAdopted && !/deleted:\s*\d{4}-\d{2}-\d{2}/.test(t)) {
      const m = /^-\s*\[([^\]]+)\]/.exec(t);
      if (m) adoptedNames.push(m[1].trim());
    }
  }
  return { fired, adopted, deleted, adoptedNames };
}

function countAuthoredSkills(beltaDir) {
  const text = readText(path.join(beltaDir, "skills", "AUTHORED.md"));
  let count = 0;
  const names = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^-\s*\[([^\]]+)\]\([^)]+\)/.exec(line.trim());
    if (m) {
      count++;
      names.push(m[1].trim());
    }
  }
  return { count, names };
}

function countUserModelItems(beltaDir) {
  const text = readText(path.join(beltaDir, "user-model.md"));
  if (!text) return 0;
  // 「確信度」を含む箇条書き項目数（観察項目の目安）
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^-\s+/.test(line.trim()) && /確信度|confidence/i.test(line)) n++;
  }
  // フォールバック: 確信度ラベルが無くても箇条書きを数える
  if (n === 0) {
    for (const line of text.split(/\r?\n/)) if (/^-\s+\S/.test(line.trim())) n++;
  }
  return n;
}

function countMemory(beltaDir) {
  const memDir = path.join(beltaDir, "memory");
  const indexText = readText(path.join(memDir, "MEMORY.md"));
  if (indexText) {
    let n = 0;
    for (const line of indexText.split(/\r?\n/)) {
      if (/^##\s+\S/.test(line.trim())) n++; // トピック見出し
    }
    if (n > 0) return n;
  }
  // フォールバック: memory/*.md のファイル数（MEMORY.md と索引以外）
  return listFiles(memDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md").length;
}

function countCorrections(beltaDir) {
  const dir = path.join(beltaDir, "audit", "repeat");
  let corrections = 0;
  for (const f of listFiles(dir)) {
    if (!f.endsWith(".json")) continue;
    const rec = readJson(path.join(dir, f));
    if (rec && Array.isArray(rec.corrections)) corrections += rec.corrections.length;
  }
  return corrections;
}

// ---- スコアリング定数 --------------------------------------------------------
const XP_WEIGHTS = {
  session: 10,
  request: 4,
  rule: 25,
  agent_adopted: 40,
  skill_authored: 50,
  memory: 15,
  usermodel_item: 8,
  streak: 30, // * round(streak_current ** 1.2)
  active_day: 12,
  token_log: 20, // * log10(1 + billable/1000)
  cache: 5, // * round(cache_hit_ratio * 100)
};

const STAGE_EMOJI = ["🥚", "🐣", "🧒", "🧑", "🧙", "👑"];
const STAGE_NAME = ["たまご", "かけだし", "一人前", "熟練", "達人", "賢者"];

function stageForLevel(level) {
  if (level >= 50) return 5;
  if (level >= 35) return 4;
  if (level >= 20) return 3;
  if (level >= 10) return 2;
  if (level >= 5) return 1;
  return 0;
}

// 累積必要 XP: cumulativeXpForLevel(L) = 100 * (L-1) * L / 2 → Lv2=100, Lv3=300, Lv4=600...
function cumulativeXpForLevel(L) {
  return (100 * (L - 1) * L) / 2;
}
function levelForXp(xp) {
  let L = 1;
  while (cumulativeXpForLevel(L + 1) <= xp) L++;
  return L;
}

function clamp100(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// 4 値の不均等さ（ジニ係数）。0=完全均等, 1=偏り最大。
function gini(values) {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return 1;
  let num = 0;
  for (const a of values) for (const b of values) num += Math.abs(a - b);
  return num / (2 * values.length * total);
}

// ---- バッジ定義（宣言的）-----------------------------------------------------
const BADGES = [
  { id: "first-steps", name: "はじめの一歩", emoji: "👣", tier: "bronze", req: "セッション 1 回", cond: (s) => s.sessions_total >= 1 },
  { id: "streak-7", name: "一週間皆勤", emoji: "🔥", tier: "silver", req: "連続稼働 7 日", cond: (s) => s.streak_max >= 7 },
  { id: "streak-30", name: "月間皆勤", emoji: "🌟", tier: "gold", req: "連続稼働 30 日", cond: (s) => s.streak_max >= 30 },
  { id: "diligent", name: "勤勉", emoji: "📅", tier: "gold", req: "稼働 30 日", cond: (s) => s.active_days >= 30 },
  { id: "rule-collector", name: "ルール蒐集家", emoji: "📚", tier: "silver", req: "学習ルール 10 個", cond: (s) => s.rules_total >= 10 },
  { id: "mistake-mender", name: "同じ轍を踏まず", emoji: "🩹", tier: "silver", req: "訂正ルール 3 個", cond: (s) => (s.rules_by_type["mistake-fix"] || 0) >= 3 },
  { id: "automator", name: "自動化の達人", emoji: "🤖", tier: "gold", req: "採用エージェント+自作スキル 5 個", cond: (s) => s.agents_adopted + s.skills_authored >= 5 },
  { id: "first-hire", name: "はじめての雇用", emoji: "🧑‍💼", tier: "bronze", req: "専用エージェント 1 体採用", cond: (s) => s.agents_adopted >= 1 },
  { id: "artisan", name: "技を授かる", emoji: "🛠️", tier: "silver", req: "自作スキル 1 個", cond: (s) => s.skills_authored >= 1 },
  { id: "polyglot", name: "四刀流", emoji: "🗡️", tier: "gold", req: "4 ツールすべて活用", cond: (s) => s.tools.notion >= 1 && s.tools.slack >= 1 && s.tools.github >= 1 && s.tools.drive >= 1 },
  { id: "cache-master", name: "キャッシュ番長", emoji: "⚡", tier: "silver", req: "キャッシュ率 70%", cond: (s) => s.cache_hit_ratio >= 0.7 },
  { id: "token-titan", name: "大量稼働", emoji: "🏋️", tier: "gold", req: "課金相当 100 万", cond: (s) => s.billable >= 1000000 },
  { id: "knowledge-keeper", name: "物覚えの達人", emoji: "🧠", tier: "bronze", req: "事実訂正メモリ 3 件", cond: (s) => s.memory_count >= 3 },
  { id: "well-understood", name: "あうんの呼吸", emoji: "🤝", tier: "silver", req: "ユーザーモデル項目 8 個", cond: (s) => s.usermodel_items >= 8 },
  { id: "early-bird", name: "朝型", emoji: "🌅", tier: "bronze", req: "朝(5-9時)の稼働 5 回", cond: (s) => s.hours.morning >= 5 },
  { id: "night-owl", name: "夜型", emoji: "🦉", tier: "bronze", req: "夜(22-4時)の稼働 5 回", cond: (s) => s.hours.night >= 5 },
];

function skillNode(hits) {
  let stage = "未解放";
  if (hits >= 15) stage = "熟練";
  else if (hits >= 5) stage = "育成中";
  else if (hits >= 1) stage = "解放";
  return { hits, stage };
}

// ---- 使用状況（よく使う依頼 / コマンド / エージェント）------------------------
// 反復検知と同じ正規化キーで「同じ趣旨の依頼」をまとめ、頻度上位を返す。
function topRequests(sessionRows, n) {
  const normalize = repeatUtil.normalizeRequest || ((s) => String(s || "").trim().toLowerCase());
  // システムが挿入する非依頼マーカー（依頼として数えない）。
  const isNoise = (s) => /^\[.*\]$/.test(s) || /request interrupted|tool use|api error|\[image #/i.test(s);
  const counts = new Map(); // key -> { count, sample }
  for (const row of sessionRows) {
    for (const req of row.requests || []) {
      const sample = String(req).replace(/\s+/g, " ").trim();
      if (isNoise(sample)) continue;
      const key = normalize(req);
      if (!key) continue; // 相槌・短文・比較不適は除外
      const cur = counts.get(key) || { count: 0, sample };
      cur.count++;
      if (sample.length > cur.sample.length) cur.sample = sample; // 代表文は長めを採用
      counts.set(key, cur);
    }
  }
  return [...counts.values()]
    .filter((c) => c.count >= 1)
    .sort((a, b) => b.count - a.count || a.sample.localeCompare(b.sample))
    .slice(0, n)
    .map((c) => ({ label: c.sample.slice(0, 60), count: c.count }));
}

// audit/commands.json / audit/agents.json（usage-track.js が書く）を読む。
function readCounterMap(file, mapKey) {
  const rec = readJson(file);
  const map = rec && rec[mapKey] && typeof rec[mapKey] === "object" ? rec[mapKey] : {};
  return Object.entries(map)
    .map(([name, v]) => ({ name, count: Number(v && v.count) || 0 }))
    .filter((e) => e.count > 0);
}

function computeUsage(beltaDir, notes, agents, skillsAuthoredObj) {
  const auditDir = path.join(beltaDir, "audit");

  // よく使うコマンド（上位 8）
  const topCommands = readCounterMap(path.join(auditDir, "commands.json"), "commands")
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((e) => ({ label: e.name, count: e.count }));

  // よく使うスキル（発火回数・上位 8）。usage-track.js が Skill ツール発火を記録。
  const topSkills = readCounterMap(path.join(auditDir, "skills.json"), "skills")
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((e) => ({ label: e.name, count: e.count }));

  // エージェント使用比率（上位 5 + その他）
  const agentRows = readCounterMap(path.join(auditDir, "agents.json"), "agents").sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
  const agentTotal = agentRows.reduce((s, e) => s + e.count, 0);
  const TOP_N = 5;
  let agentItems = agentRows.slice(0, TOP_N).map((e) => ({ name: e.name, count: e.count }));
  const restCount = agentRows.slice(TOP_N).reduce((s, e) => s + e.count, 0);
  if (restCount > 0) agentItems.push({ name: "その他", count: restCount });
  agentItems = agentItems.map((e) => ({ ...e, pct: agentTotal > 0 ? Math.round((e.count / agentTotal) * 100) : 0 }));

  return {
    top_requests: topRequests(notes.sessionRows, 5),
    top_skills: topSkills,
    top_commands: topCommands,
    agent_usage: { total: agentTotal, items: agentItems },
    agents_adopted: agents.adoptedNames || [],
    skills_authored: skillsAuthoredObj.names || [],
  };
}

// ---- メイン集計 --------------------------------------------------------------
function computeStats(opts = {}) {
  const beltaDir = opts.dir || path.join(homeDir(), ".belta");
  const write = opts.write !== false; // 既定 true
  const avatarDir = path.join(beltaDir, "avatar");

  const notes = scanNotes(path.join(beltaDir, "notes"));
  const tokenAgg = aggregateTokensInline(path.join(beltaDir, "audit", "tokens"));
  const rules = countRules(beltaDir);
  const agents = countAgents(beltaDir);
  const skillsAuthoredObj = countAuthoredSkills(beltaDir);
  const skillsAuthored = skillsAuthoredObj.count;
  const usermodelItems = countUserModelItems(beltaDir);
  const memoryCount = countMemory(beltaDir);
  const corrections = countCorrections(beltaDir);

  // 使用状況（頻出依頼 / コマンド / エージェント呼び出し）— ダッシュボードの可視化用。
  const usage = computeUsage(beltaDir, notes, agents, skillsAuthoredObj);

  // 永続台帳を更新（剪定耐性）
  let history = loadHistory(avatarDir);
  history = updateHistory(history, notes);
  if (write) {
    try {
      fs.mkdirSync(avatarDir, { recursive: true });
      const tmp = path.join(avatarDir, "history.json.tmp");
      fs.writeFileSync(tmp, JSON.stringify(history, null, 2));
      fs.renameSync(tmp, path.join(avatarDir, "history.json"));
    } catch {
      /* 書けなくても集計は続行（fail-open） */
    }
  }

  const streak = computeStreak(history.active_days);
  const billable = tokenAgg.totals.billable_token_estimate;
  const cacheHit = tokenAgg.cache_hit_ratio;
  // ツール分布は台帳の過去最大 union（剪定耐性）
  const tools = {
    notion: history.tool_totals.notion || 0,
    slack: history.tool_totals.slack || 0,
    github: history.tool_totals.github || 0,
    drive: history.tool_totals.drive || 0,
  };

  // ---- XP / レベル ----
  const xp = Math.round(
    XP_WEIGHTS.session * history.sessions_total +
      XP_WEIGHTS.request * history.requests_total +
      XP_WEIGHTS.rule * rules.total +
      XP_WEIGHTS.agent_adopted * agents.adopted +
      XP_WEIGHTS.skill_authored * skillsAuthored +
      XP_WEIGHTS.memory * memoryCount +
      XP_WEIGHTS.usermodel_item * usermodelItems +
      XP_WEIGHTS.streak * Math.round(Math.pow(streak.current, 1.2)) +
      XP_WEIGHTS.active_day * history.active_days.length +
      XP_WEIGHTS.token_log * Math.log10(1 + billable / 1000) +
      XP_WEIGHTS.cache * Math.round(cacheHit * 100)
  );
  const level = levelForXp(xp);
  const stageIndex = stageForLevel(level);
  const xpFloor = cumulativeXpForLevel(level);
  const xpNext = cumulativeXpForLevel(level + 1);

  // ---- 6 軸ステータス ----
  const toolValues = [tools.notion, tools.slack, tools.github, tools.drive];
  const activeToolCount = toolValues.filter((v) => v >= 1).length;
  const evenness = 1 - gini(toolValues);
  const stats6 = {
    stamina: clamp100(streak.current * 8 + history.active_days.length * 2),
    wisdom: clamp100(rules.total * 6 + memoryCount * 4 + usermodelItems * 3),
    power: clamp100(agents.adopted * 15 + skillsAuthored * 18),
    agility: clamp100(cacheHit * 100),
    versatility: clamp100((activeToolCount / 4) * 50 + evenness * 50),
    discipline: clamp100(100 - corrections * 5 + (rules.byType["mistake-fix"] || 0) * 3),
  };

  // ---- バッジ判定 ----
  const flat = {
    sessions_total: history.sessions_total,
    requests_total: history.requests_total,
    active_days: history.active_days.length,
    streak_current: streak.current,
    streak_max: streak.max,
    rules_total: rules.total,
    rules_by_type: rules.byType,
    agents_adopted: agents.adopted,
    agents_fired: agents.fired,
    skills_authored: skillsAuthored,
    memory_count: memoryCount,
    usermodel_items: usermodelItems,
    cache_hit_ratio: cacheHit,
    billable,
    corrections,
    tools,
    hours: notes.hourCounts,
  };
  const earned = [];
  const locked = [];
  for (const b of BADGES) {
    const entry = { id: b.id, name: b.name, emoji: b.emoji, tier: b.tier, req: b.req };
    let ok = false;
    try {
      ok = !!b.cond(flat);
    } catch {
      ok = false;
    }
    if (ok) earned.push(entry);
    else locked.push(entry);
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    level,
    xp,
    xp_into_level: xp - xpFloor,
    xp_for_next: xpNext - xpFloor,
    stage: STAGE_NAME[stageIndex],
    stage_index: stageIndex,
    stage_emoji: STAGE_EMOJI[stageIndex],
    stats: stats6,
    streak,
    badges: { earned, locked },
    skill_tree: {
      notion: skillNode(tools.notion),
      slack: skillNode(tools.slack),
      github: skillNode(tools.github),
      drive: skillNode(tools.drive),
    },
    usage,
    raw: {
      first_seen: history.first_seen,
      sessions: history.sessions_total,
      requests: history.requests_total,
      active_days: history.active_days.length,
      rules: { total: rules.total, by_type: rules.byType },
      agents: { fired: agents.fired, adopted: agents.adopted, deleted: agents.deleted },
      skills_authored: skillsAuthored,
      usermodel_items: usermodelItems,
      memory: memoryCount,
      corrections,
      tokens: { billable_token_estimate: billable, cache_hit_ratio: cacheHit, turns: tokenAgg.totals.turns },
      tools,
    },
  };
}

// ---- CLI ---------------------------------------------------------------------
function runCli() {
  const argv = process.argv.slice(2);
  let dir = null;
  let md = false;
  let write = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") dir = argv[++i];
    else if (a === "--md") md = true;
    else if (a === "--json") md = false;
    else if (a === "--no-write") write = false;
    else if (a === "-h" || a === "--help") {
      process.stdout.write("使い方: node avatar-stats.js [--json|--md] [--dir <path>] [--no-write]\n");
      process.exit(0);
    }
  }

  let stats;
  try {
    stats = computeStats({ dir, write });
  } catch {
    // fail-open: 最低限の空 JSON
    stats = { schema_version: 1, generated_at: new Date().toISOString(), level: 1, xp: 0, stage: STAGE_NAME[0], stage_index: 0, stage_emoji: STAGE_EMOJI[0], stats: {}, streak: { current: 0, max: 0 }, badges: { earned: [], locked: [] }, skill_tree: {}, raw: {} };
  }

  if (!md) {
    process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
    process.exit(0);
  }

  const e = stats.badges.earned.map((b) => `${b.emoji}${b.name}`).join(" ") || "（まだなし）";
  const lines = [
    `# ${stats.stage_emoji} アバター — Lv.${stats.level}「${stats.stage}」`,
    "",
    `- XP: ${stats.xp}（次のレベルまで ${Math.max(0, stats.xp_for_next - stats.xp_into_level)}）`,
    `- 連続稼働: ${stats.streak.current} 日（最長 ${stats.streak.max} 日） / 稼働 ${stats.raw.active_days} 日`,
    `- ステータス: 継続${stats.stats.stamina} 知識${stats.stats.wisdom} 自動化${stats.stats.power} 効率${stats.stats.agility} 多才${stats.stats.versatility} 規律${stats.stats.discipline}`,
    `- 学習: ルール${stats.raw.rules.total} / 採用エージェント${stats.raw.agents.adopted} / 自作スキル${stats.raw.skills_authored} / 記憶${stats.raw.memory}`,
    `- 獲得バッジ: ${e}`,
  ];
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

if (require.main === module) {
  runCli();
}

module.exports = { computeStats, BADGES, XP_WEIGHTS, levelForXp, cumulativeXpForLevel, stageForLevel, STAGE_NAME, STAGE_EMOJI };
