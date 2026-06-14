#!/usr/bin/env node
//
// BELTA workflow plugin — notes 走査エンジン（insights / user-model 共用）
//
// `~/.belta/notes/` の日次ログ（YYYY-MM-DD.md）とトピックノート（kebab-case.md）を
// 決定的に走査し、振り返り（insights）や暗黙ユーザーモデル深化（user-model）の
// 「材料」を JSON で stdout に出す。意味判断・要約・ファイル更新は LLM スキルが行う。
//
// 設計方針（notes-record.js / repeat-util.js と同じ鉄則）:
//   - シェル非依存の Node.js のみ（Claude Code 同梱 node）。Mac / Windows 両対応。
//     パスは path API、ホームは環境変数から解決、改行は /\r?\n/ で両対応。
//   - SQLite / FTS5 等の外部依存は持ち込まない。notes の全文 grep も純 JS。
//   - 反復検知と同じ正規化を使うため `hooks/repeat-util.js` を再利用する
//     （normalizeRequest / parseNotesSessions / STOPWORDS）。検知とインサイトで
//     「同じ依頼」の判定基準をブレさせない。
//   - fail-open: notes が無い・壊れていても落とさず、空の結果 JSON を出して exit 0。
//
// 使い方:
//   node notes-scan.js [--days N] [--topic <語>] [--mode default|user-model] [--dir <path>]
//     --days N      走査対象の暦日数（既定: default=7 / user-model=14）
//     --topic <語>  指定語を含む行を全 notes から grep（includes ベース）
//     --mode        default（振り返り材料）/ user-model（傾向材料・窓を広めに）
//     --dir <path>  .belta のベースを上書き（既定 <home>/.belta）。テスト用
//
// 出力: JSON 1 つ（下記 buildResult の構造）。常に exit 0。

const fs = require("fs");
const path = require("path");
const os = require("os");

// 反復検知と共通の正規化・パーサを再利用（判定基準を一元化）。
let repeatUtil;
try {
  repeatUtil = require(path.join(__dirname, "..", "hooks", "repeat-util.js"));
} catch {
  // 万一読めなくても落とさない。最小実装で代替する。
  repeatUtil = {
    normalizeRequest: (s) => (typeof s === "string" ? s.trim().toLowerCase() : ""),
    parseNotesSessions: () => [],
    STOPWORDS: new Set(),
  };
}
const { normalizeRequest, parseNotesSessions } = repeatUtil;

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let days = null;
let topic = null;
let mode = "default";
let dirOverride = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--days") days = parseInt(argv[++i], 10);
  else if (a === "--topic") topic = argv[++i];
  else if (a === "--mode") mode = argv[++i];
  else if (a === "--dir") dirOverride = argv[++i];
}
if (mode !== "user-model") mode = "default";
if (!Number.isFinite(days) || days <= 0) days = mode === "user-model" ? 14 : 7;
if (days > 366) days = 366; // 暴走防止の上限

// ---- パス解決 ----------------------------------------------------------------
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}
const beltaDir = dirOverride || path.join(homeDir(), ".belta");
const notesDir = path.join(beltaDir, "notes");

// ---- 日付ユーティリティ ------------------------------------------------------
function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ファイル名の日付が「今日から days-1 日以内」かを判定する。
function withinWindow(y, m, d) {
  const fileMs = Date.parse(`${y}-${m}-${d}T00:00:00Z`);
  if (!Number.isFinite(fileMs)) return false;
  const t = todayStamp();
  const todayMs = Date.parse(`${t}T00:00:00Z`);
  if (!Number.isFinite(todayMs)) return false;
  const diffDays = Math.floor((todayMs - fileMs) / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays <= days - 1;
}

// ---- 走査 --------------------------------------------------------------------
function listNoteFiles() {
  let names = [];
  try {
    names = fs.readdirSync(notesDir);
  } catch {
    return { daily: [], topic: [] };
  }
  const daily = [];
  const topicFiles = [];
  for (const name of names) {
    const m = /^(\d{4})-(\d{2})-(\d{2})\.md$/.exec(name);
    if (m) {
      if (withinWindow(m[1], m[2], m[3])) daily.push(name);
      continue;
    }
    if (/\.md$/.test(name)) topicFiles.push(name); // kebab-case.md 等のトピックノート
  }
  daily.sort(); // 昇順（古い→新しい）
  topicFiles.sort();
  return { daily, topic: topicFiles };
}

function readFileSafe(name) {
  try {
    return fs.readFileSync(path.join(notesDir, name), "utf8");
  } catch {
    return "";
  }
}

// Markdown 見出し（# / ## / ...）を抽出する。
function extractHeadings(text) {
  const out = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(rawLine);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function buildResult() {
  const { daily, topic: topicFiles } = listNoteFiles();

  // 1) 日次ログから利用者依頼を構造抽出（notes-record.js の書式を parseNotesSessions で）。
  const sessions = [];
  for (const name of daily) {
    const date = name.replace(/\.md$/, "");
    const rows = parseNotesSessions(readFileSafe(name));
    for (const r of rows) {
      sessions.push({ date, sessionId: r.sessionId, requests: r.requests });
    }
  }

  // 2) 正規化キーで依頼頻度を集計（同じ趣旨の依頼をまとめる）。
  const freq = new Map(); // key -> { count, samples:Set }
  let requestCount = 0;
  for (const s of sessions) {
    for (const req of s.requests) {
      requestCount++;
      const key = normalizeRequest(req);
      if (!key) continue;
      if (!freq.has(key)) freq.set(key, { count: 0, samples: new Set() });
      const e = freq.get(key);
      e.count++;
      if (e.samples.size < 3) e.samples.add(req);
    }
  }
  const topRequests = [...freq.entries()]
    .map(([key, e]) => ({ key, count: e.count, samples: [...e.samples] }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 30);

  // 3) トピックノートの見出し一覧（知識の地図）。
  const topicNotes = topicFiles.map((name) => ({
    file: name,
    headings: extractHeadings(readFileSafe(name)).slice(0, 20),
  }));

  // 4) --topic 指定時は全 notes（日次＋トピック）から includes grep。
  let topicMatches = null;
  if (topic && String(topic).trim()) {
    const needle = String(topic).trim().toLowerCase();
    topicMatches = [];
    const scanFiles = daily.concat(topicFiles);
    for (const name of scanFiles) {
      const text = readFileSafe(name);
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.toLowerCase().includes(needle)) {
          topicMatches.push({ file: name, text: line.slice(0, 200) });
          if (topicMatches.length >= 200) break; // 上限
        }
      }
      if (topicMatches.length >= 200) break;
    }
  }

  return {
    generated_at: new Date().toISOString(),
    mode,
    days,
    to: daily.length ? daily[daily.length - 1].replace(/\.md$/, "") : todayStamp(),
    from: daily.length ? daily[0].replace(/\.md$/, "") : todayStamp(),
    topic: topic || null,
    daily_files: daily,
    session_count: sessions.length,
    request_count: requestCount,
    sessions,
    top_requests: topRequests,
    topic_notes: topicNotes,
    topic_matches: topicMatches,
  };
}

// ---- 出力（fail-open）--------------------------------------------------------
function emptyResult() {
  return {
    generated_at: new Date().toISOString(),
    mode,
    days,
    to: todayStamp(),
    from: todayStamp(),
    topic: topic || null,
    daily_files: [],
    session_count: 0,
    request_count: 0,
    sessions: [],
    top_requests: [],
    topic_notes: [],
    topic_matches: topic ? [] : null,
  };
}

try {
  process.stdout.write(JSON.stringify(buildResult(), null, 2) + "\n");
} catch {
  try {
    process.stdout.write(JSON.stringify(emptyResult(), null, 2) + "\n");
  } catch {
    /* それでも失敗したら何も出さない */
  }
}
process.exit(0);
