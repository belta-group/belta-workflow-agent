#!/usr/bin/env node
//
// Belta workflow plugin — notes 自動記録 + retention フック（Stop）
//
// メインエージェントの応答が終わるたびに発火し、トランスクリプト（JSONL）から
// その日の「利用者の依頼」を機械的に抽出して、当日の notes ファイル
// （<home>/.belta/notes/YYYY-MM-DD.md）に 1 セッション 1 行で upsert する。
// あわせて保持期間（既定 14 日）を過ぎた日次 notes を削除する。
//
// 目的:
//   - workflow スキルの「自動記録」は LLM 任せのソフト指示で取りこぼしが起きる。
//     反復検知（rule-learning / agent-learning）はこの notes を土台にするため、
//     最低限の確定的な記録をフックで保証する（＝確実化）。
//   - notes を無限に溜めないため retention で日次ログを掃除する。
//
// 設計方針（token-usage.js と同じ鉄則）:
//   - シェル非依存の Node.js（Claude Code 同梱の node）。Mac / Windows 両対応。
//     パスは path API で連結、ホームは環境変数から解決（区切り直書きしない）。
//   - 1 セッション = 当日ファイル内の 1 行。Stop が何度発火しても [session:<id>]
//     の行を upsert（在れば置換／無ければ追記）するので二重計上しない。
//   - LLM が書いた他の行（意思決定・学び等）は触らない（その行以外は全保持）。
//   - retention は **日次ファイル（YYYY-MM-DD.md）のみ**対象。トピックノート
//     （kebab-case.md）は知識として残すため削除しない。
//   - フックはセッションを止めない。何が起きても無出力で exit 0（fail-open）。
//
// 入力: stdin に Stop の JSON（session_id / transcript_path / cwd 等）。
// 出力: なし（常に exit 0）。

const fs = require("fs");
const path = require("path");
const os = require("os");

// 相槌・短文・スラッシュコマンド・選択肢への番号回答（「1」「1を実行して」等）を
// 「依頼」として記録しないためのフィルタ。反復検知（repeat-detect.js / session-start.js）と
// 同じ判定を共有する。読み込めない環境では従来どおり全件記録に倒す（fail-open）。
let normalizeRequest = null;
try {
  ({ normalizeRequest } = require(path.join(__dirname, "repeat-util.js")));
} catch {
  /* フィルタ無しで続行 */
}

const DEFAULT_RETENTION_DAYS = 14; // agent-learning の「直近 5 営業日」窓を週末込みで確実に覆う既定
const MIN_RETENTION_DAYS = 7; // 検知窓を割らないための下限
const MAX_REQUESTS_PER_LINE = 8; // 1 行に残す依頼の最大数（古いものから切り捨て）
const MAX_REQUEST_CHARS = 120; // 依頼 1 件あたりの最大文字数

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function resolveHome() {
  // POSIX: $HOME / Windows: %USERPROFILE%。どちらも無ければ os.homedir()。
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}

function safeExit() {
  // 何があってもセッションを止めない。
  process.exit(0);
}

// 当日（ローカル）の YYYY-MM-DD。
function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// HH:MM（ローカル）。
function nowHm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// config.yaml から notes_retention_days を読む（最小パーサ。失敗時は既定）。
function readRetentionDays(beltaDir) {
  try {
    const text = fs.readFileSync(path.join(beltaDir, "config.yaml"), "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      if (line.slice(0, idx).trim() !== "notes_retention_days") continue;
      let val = line.slice(idx + 1).trim();
      if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      const n = parseInt(val, 10);
      if (Number.isFinite(n)) return Math.max(MIN_RETENTION_DAYS, n);
      break;
    }
  } catch {
    /* 未設定・読めない → 既定 */
  }
  return DEFAULT_RETENTION_DAYS;
}

// 1 件の利用者発話から、記録用の 1 行サマリを作る（注入タグを除去）。
function cleanRequestText(text) {
  if (typeof text !== "string") return "";
  let t = text;
  // ハーネスが注入する各種タグ（利用者の発話ではない）を除去する。
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ");
  t = t.replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/g, " ");
  t = t.replace(/<local-command-[^>]*>[\s\S]*?<\/local-command-[^>]*>/g, " ");
  t = t.replace(/<[^>]+>/g, " "); // 残った単独タグ
  // 1 行化・空白圧縮。
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length > MAX_REQUEST_CHARS) t = t.slice(0, MAX_REQUEST_CHARS - 1) + "…";
  return t;
}

// トランスクリプト（JSONL）から「人間の利用者発話」だけを順に抽出する。
function extractUserRequests(transcript) {
  const requests = [];
  for (const line of transcript.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    // メタ・サイドチェーン・要約エントリは利用者発話ではない。
    if (entry.isMeta || entry.isCompactSummary || entry.isSidechainEntry) continue;
    const msg = entry.message;
    if (!msg || msg.role !== "user") continue;

    // content は文字列か配列。配列なら text ブロックのみを拾い、tool_result は除外。
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      const isToolResultOnly = msg.content.every((b) => b && b.type === "tool_result");
      if (isToolResultOnly) continue;
      text = msg.content
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join(" ");
    } else {
      continue;
    }

    const cleaned = cleanRequestText(text);
    if (!cleaned) continue;
    // 相槌・短文・選択肢への番号回答は「依頼」でないため記録しない。
    if (normalizeRequest && !normalizeRequest(text)) continue;
    // 直前と同一なら重ねない。
    if (requests.length && requests[requests.length - 1] === cleaned) continue;
    requests.push(cleaned);
  }
  return requests;
}

// 当日ファイルに [session:<id>] 行を upsert する（他行は保全）。
function upsertSessionLine(filePath, sessionTag, newLine, dateStamp) {
  let lines = [];
  let existed = false;
  try {
    const text = fs.readFileSync(filePath, "utf8");
    existed = true;
    lines = text.split(/\r?\n/);
  } catch {
    existed = false;
  }

  if (!existed) {
    // 新規ファイルは最小ヘッダだけ置く（LLM の追記様式と衝突しない軽量構成）。
    lines = [`# notes ${dateStamp}`, ""];
  }

  const marker = `[session:${sessionTag}]`;
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(marker)) {
      lines[i] = newLine;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    // 末尾の余分な空行を 1 つに整えてから追記。
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(newLine);
  }

  let out = lines.join("\n");
  if (!out.endsWith("\n")) out += "\n";

  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp`);
  fs.writeFileSync(tmp, out, "utf8");
  fs.renameSync(tmp, filePath);
}

// 保持期間を過ぎた日次 notes（YYYY-MM-DD.md のみ）を削除する。
function pruneOldDailyNotes(notesDir, retentionDays) {
  let names = [];
  try {
    names = fs.readdirSync(notesDir);
  } catch {
    return;
  }
  const cutoffMs = retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const name of names) {
    const m = /^(\d{4})-(\d{2})-(\d{2})\.md$/.exec(name);
    if (!m) continue; // トピックノート（kebab-case.md 等）は対象外
    const fileMs = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    if (!Number.isFinite(fileMs)) continue;
    if (now - fileMs > cutoffMs) {
      try {
        fs.rmSync(path.join(notesDir, name), { force: true });
      } catch {
        /* 消せなくても致命ではない */
      }
    }
  }
}

try {
  const payload = JSON.parse(readStdin() || "{}");
  const sessionId = String(payload.session_id || "").trim();
  const transcriptPath = String(payload.transcript_path || "").trim();
  if (!sessionId || !transcriptPath) safeExit();

  const home = resolveHome();
  if (!home) safeExit();
  const beltaDir = path.join(home, ".belta");
  const notesDir = path.join(beltaDir, "notes");

  let transcript = "";
  try {
    transcript = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    safeExit();
  }

  const requests = extractUserRequests(transcript);

  // 記録すべき依頼があるときだけ書く。retention は依頼の有無に関わらず実行。
  fs.mkdirSync(notesDir, { recursive: true });

  if (requests.length > 0) {
    const recent = requests.slice(-MAX_REQUESTS_PER_LINE);
    const sessionTag = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 8);
    const dateStamp = todayStamp();
    const line = `- ${nowHm()} [session:${sessionTag}] 依頼: ${recent.join(" / ")}`;
    const filePath = path.join(notesDir, `${dateStamp}.md`);
    upsertSessionLine(filePath, sessionTag, line, dateStamp);
  }

  pruneOldDailyNotes(notesDir, readRetentionDays(beltaDir));
} catch {
  // 握りつぶす（セッションを止めない）。
}

safeExit();
