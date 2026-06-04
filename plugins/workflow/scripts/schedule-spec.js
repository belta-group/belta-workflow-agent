#!/usr/bin/env node
//
// Belta workflow plugin — スケジューラ補助（cron 生成・検証・belta ジョブ列挙）
//
// 定期実行の実体は `mcp__scheduled-tasks`（または CronCreate）に委譲する。本スクリプトは
// その登録を助ける **決定的な部分** だけを担う：
//   - 自然言語の頻度語（「毎朝9時」「週次金曜」）→ cron 式の候補生成
//   - cron 式（5 フィールド）の構文検証
//   - ~/.claude/scheduled-tasks/ から本プラグイン由来ジョブ（taskId が "belta-wf-" 始まり）を列挙
//     （"belta-" だけだと利用者の他用途ジョブと衝突しうるため、workflow プラグイン専用に "belta-wf-"）
//
// 意味判断（どのテンプレを・いつ・どんなプロンプトで登録するか）は scheduler スキル（LLM）。
//
// 設計方針（cross-platform.md 準拠）:
//   - シェル非依存の Node.js のみ。パスは path API、ホームは環境変数から解決、改行は /\r?\n/。
//   - 外部依存なし（cron パーサも自前の最小実装）。
//   - fail-open: 失敗しても JSON で状態を返し、例外で落とさない。列挙系は空配列を返す。
//
// 使い方:
//   node schedule-spec.js cron "<頻度語>"      頻度語 → cron 候補（JSON）
//   node schedule-spec.js validate "<cron>"   5 フィールド cron の検証（JSON）
//   node schedule-spec.js list                 belta-wf- ジョブ列挙（JSON）
//
// 出力: JSON 1 つ。常に exit 0。

const fs = require("fs");
const path = require("path");
const os = require("os");

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}

// ---- cron 検証（5 フィールド: 分 時 日 月 曜）---------------------------------
// 各フィールド: *  /  数値  範囲(a-b)  リスト(a,b)  ステップ(*/n, a-b/n)。範囲は緩めに許容。
function isValidField(field, min, max) {
  if (typeof field !== "string" || field === "") return false;
  for (const part of field.split(",")) {
    if (part === "*") continue;
    let m;
    if ((m = /^(\*|\d+|\d+-\d+)(\/(\d+))?$/.exec(part))) {
      const base = m[1];
      const step = m[3];
      if (step !== undefined && !(Number(step) >= 1)) return false;
      if (base === "*") continue;
      if (/^\d+$/.test(base)) {
        const n = Number(base);
        if (n < min || n > max) return false;
      } else {
        const [a, b] = base.split("-").map(Number);
        if (a < min || b > max || a > b) return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

function validateCron(expr) {
  const result = { input: expr, valid: false, reason: "" };
  if (typeof expr !== "string" || !expr.trim()) {
    result.reason = "空の式";
    return result;
  }
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    result.reason = `フィールド数が ${fields.length}（5 が必要: 分 時 日 月 曜）`;
    return result;
  }
  const specs = [
    ["分", 0, 59],
    ["時", 0, 23],
    ["日", 1, 31],
    ["月", 1, 12],
    ["曜", 0, 6], // 0=日
  ];
  for (let i = 0; i < 5; i++) {
    if (!isValidField(fields[i], specs[i][1], specs[i][2])) {
      result.reason = `${specs[i][0]}フィールド "${fields[i]}" が不正`;
      return result;
    }
  }
  result.valid = true;
  return result;
}

// ---- 頻度語 → cron 候補 -------------------------------------------------------
const WEEKDAY_MAP = [
  { re: /(日曜|にちよう|sunday|sun)/i, dow: 0 },
  { re: /(月曜|げつよう|monday|mon)/i, dow: 1 },
  { re: /(火曜|かよう|tuesday|tue)/i, dow: 2 },
  { re: /(水曜|すいよう|wednesday|wed)/i, dow: 3 },
  { re: /(木曜|もくよう|thursday|thu)/i, dow: 4 },
  { re: /(金曜|きんよう|friday|fri)/i, dow: 5 },
  { re: /(土曜|どよう|saturday|sat)/i, dow: 6 },
];

// 「9時」「9:30」「午後3時」「15時」などから時:分を推定。
function parseTime(text) {
  let hour = null;
  let minute = 0;
  const pm = /(午後|pm|p\.m\.)/i.test(text);
  const am = /(午前|am|a\.m\.)/i.test(text);
  let m;
  if ((m = /(\d{1,2})\s*[:：]\s*(\d{1,2})/.exec(text))) {
    hour = Number(m[1]);
    minute = Number(m[2]);
  } else if ((m = /(\d{1,2})\s*時\s*(半)?/.exec(text))) {
    hour = Number(m[1]);
    if (m[2]) minute = 30;
  } else if ((m = /\b(\d{1,2})\s*(am|pm|時)?/i.exec(text)) && /時|am|pm/i.test(text)) {
    hour = Number(m[1]);
  }
  if (hour !== null) {
    if (pm && hour < 12) hour += 12;
    if (am && hour === 12) hour = 0;
    if (hour < 0 || hour > 23) hour = null;
    if (minute < 0 || minute > 59) minute = 0;
  }
  return hour === null ? null : { hour, minute };
}

function suggestCron(phrase) {
  const text = String(phrase || "");
  const out = { input: text, candidates: [] };
  const time = parseTime(text);
  const hour = time ? time.hour : 9; // 既定 9 時
  const minute = time ? time.minute : 0;

  const add = (cron, label) => {
    if (validateCron(cron).valid) out.candidates.push({ cron, label });
  };

  const isWeekly = /(毎週|週次|週一|毎週末|weekly|every week)/i.test(text);
  const isMonthly = /(毎月|月次|monthly|every month)/i.test(text);
  const isWeekday = /(平日|weekday|月.?金|月〜金|月-金)/i.test(text);
  const isDaily = /(毎日|毎朝|毎晩|毎夕|日次|daily|every day|朝|晩|夕方|夜)/i.test(text);

  // 曜日指定があれば週次扱い
  const matchedDow = WEEKDAY_MAP.filter((w) => w.re.test(text)).map((w) => w.dow);

  if (matchedDow.length) {
    add(`${minute} ${hour} * * ${matchedDow.join(",")}`, `毎週 指定曜日 ${hour}:${String(minute).padStart(2, "0")}`);
  }
  if (isWeekly && !matchedDow.length) {
    add(`${minute} ${hour} * * 1`, `毎週 月曜 ${hour}:${String(minute).padStart(2, "0")}`);
  }
  if (isMonthly) {
    add(`${minute} ${hour} 1 * *`, `毎月 1 日 ${hour}:${String(minute).padStart(2, "0")}`);
  }
  if (isWeekday) {
    add(`${minute} ${hour} * * 1-5`, `平日 ${hour}:${String(minute).padStart(2, "0")}`);
  }
  if (isDaily && !isWeekday) {
    add(`${minute} ${hour} * * *`, `毎日 ${hour}:${String(minute).padStart(2, "0")}`);
  }

  // 何も判定できなければ、時刻だけ拾って毎日案を出す（フォールバック）。
  if (!out.candidates.length) {
    add(`${minute} ${hour} * * *`, `毎日 ${hour}:${String(minute).padStart(2, "0")}（推定）`);
    add(`${minute} ${hour} * * 1`, `毎週 月曜 ${hour}:${String(minute).padStart(2, "0")}（推定）`);
  }
  return out;
}

// ---- belta- ジョブ列挙 --------------------------------------------------------
function listBeltaJobs() {
  const dir = path.join(homeDir(), ".claude", "scheduled-tasks");
  const out = { dir, available: false, jobs: [] };
  let names = [];
  try {
    names = fs.readdirSync(dir);
    out.available = true;
  } catch {
    return out; // ディレクトリ無し = まだ何も登録されていない / 機能未提供の可能性
  }
  for (const name of names) {
    if (!name.startsWith("belta-wf-")) continue;
    const skillPath = path.join(dir, name, "SKILL.md");
    let description = "";
    let cron = "";
    try {
      const text = fs.readFileSync(skillPath, "utf8");
      // frontmatter から description らしき行を拾う（最小・緩め）。
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        let m;
        if ((m = /^description:\s*(.+)$/.exec(line)) && !description) description = m[1].replace(/^["']|["']$/g, "");
        if ((m = /(cron[^:]*:\s*)(.+)$/i.exec(line)) && !cron) cron = m[2].trim();
      }
    } catch {
      /* 読めなくても taskId は出す */
    }
    out.jobs.push({ taskId: name, description, cronHint: cron });
  }
  out.jobs.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return out;
}

// ---- ディスパッチ ------------------------------------------------------------
const argv = process.argv.slice(2);
const command = argv[0] || "";
let result;
try {
  if (command === "cron") {
    result = suggestCron(argv.slice(1).join(" "));
  } else if (command === "validate") {
    result = validateCron(argv.slice(1).join(" "));
  } else if (command === "list") {
    result = listBeltaJobs();
  } else {
    result = { error: "usage: schedule-spec.js cron|validate|list [...]" };
  }
} catch (e) {
  result = { error: "internal", detail: String(e && e.message) };
}
try {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch {
  /* 出力失敗は無視 */
}
process.exit(0);
