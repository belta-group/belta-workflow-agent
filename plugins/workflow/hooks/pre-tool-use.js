#!/usr/bin/env node
//
// Belta workflow plugin — PII / 機密検知フック（PreToolUse）
//
// 外部送信・書き込み系のツール呼び出しの直前に発火し、ペイロードに
// マイナンバー / クレジットカード / メールアドレス一括 / 機密ラベル
// （マル秘・社外秘・Confidential）/ パスワードリテラルが含まれていれば
// その呼び出しを deny する。読み取り系・対象外ツールは素通し（出力なし）し、
// 通常の permission フロー（allow / ask）に委ねる。
//
// Mac / Windows 両対応のためシェル非依存の Node.js で実装する
// （Claude Code 同梱の node ランタイムで動作。grep / sed に依存しない）。
//
// 入力: stdin に PreToolUse の JSON（tool_name / tool_input）。
// 出力: deny 時のみ permissionDecision JSON を stdout に出す。それ以外は無出力 exit 0。

const fs = require("fs");

// ---- stdin 読み取り（両 OS 共通。fd 0 を同期読み）-----------------------------
let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  raw = "";
}

let payload = {};
try {
  payload = JSON.parse(raw || "{}");
} catch {
  payload = {};
}

const toolName = String(payload.tool_name || "");
const toolInput = payload.tool_input || {};

// ---- 対象判定：この呼び出しが「外部送信・書き込み系」か ----------------------
// MCP 書き込み系ツール（claude.ai Connector）。ツール名はサーバ接頭辞付き
// （mcp__<id>__slack_send_message 等）のため、サフィックスで判定する。
const MCP_WRITE_PATTERNS = [
  /slack_send_message(_draft)?$/,
  /slack_create_canvas$/,
  /slack_schedule_message$/,
  /slack_update_canvas$/,
  /notion-create-[\w-]+$/,
  /notion-update-[\w-]+$/,
  /notion-create-comment$/,
  /notion-duplicate-page$/,
  /notion-move-pages$/,
  /create_file$/, // Google Drive
  /copy_file$/, // Google Drive
];

// Bash コマンド内の書き込み系サブコマンド。コマンド先頭または区切り直後の
// トークンを対象にし、URL 内の http:// 等での誤検知を避ける。
function bashWriteReasons(cmd) {
  const reasons = [];
  if (/\bgh\s+(issue|pr)\s+(create|comment|edit)\b/.test(cmd)) reasons.push("gh issue/pr 書き込み");
  if (/\bgh\s+(release|gist)\s+create\b/.test(cmd)) reasons.push("gh release/gist 作成");
  if (/\bgh\s+api\b[\s\S]*--method\s+(POST|PATCH|PUT)\b/i.test(cmd)) reasons.push("gh api 書き込み（POST/PATCH/PUT）");
  if (/(^|[;&|]\s*)(curl|wget|http)\b/.test(cmd)) reasons.push("HTTP クライアント送信（curl/wget/http）");
  return reasons;
}

// 対象なら { scanText, channel } を返す。対象外なら null。
function resolveTarget() {
  // Bash（ツール名は "Bash" もしくはサフィックス一致）
  if (/(^|_)Bash$/.test(toolName) || toolName === "Bash") {
    const cmd = String(toolInput.command || "");
    const reasons = bashWriteReasons(cmd);
    if (reasons.length === 0) return null;
    return { scanText: cmd, channel: `Bash（${reasons.join(" / ")}）` };
  }
  // MCP 書き込み系
  if (MCP_WRITE_PATTERNS.some((re) => re.test(toolName))) {
    // 入力値すべてを走査対象にする（文字列化）
    return { scanText: JSON.stringify(toolInput), channel: toolName };
  }
  return null;
}

const target = resolveTarget();
if (!target) {
  // 対象外：通常の permission フローに委ねる
  process.exit(0);
}

// ---- PII / 機密検知 ----------------------------------------------------------
function luhnValid(candidate) {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function detect(text) {
  const hits = [];

  // クレジットカード：16 桁（4 桁 ×4、区切り任意）+ Luhn 検証で誤検知抑制
  const ccCandidates = text.match(/(?<!\d)(?:\d{4}[ -]?){3}\d{4}(?!\d)/g) || [];
  if (ccCandidates.some(luhnValid)) hits.push("クレジットカード番号");

  // マイナンバー：12 桁（4-4-4）。前後にもう 1 グループが続く場合（= 16 桁の
  // クレジットカード等）は除外し、CC との二重検出を避ける。
  if (/(?<!\d)(?<!\d[ -])\d{4}[ -]?\d{4}[ -]?\d{4}(?![ -]?\d)/.test(text)) hits.push("マイナンバー（12 桁）");

  // メールアドレス一括：ユニーク 5 件以上
  const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
  const uniqueEmails = new Set(emails.map((e) => e.toLowerCase()));
  if (uniqueEmails.size >= 5) hits.push(`メールアドレス一括（${uniqueEmails.size} 件）`);

  // 機密ラベル
  if (/マル秘|㊙|社外秘|Confidential/i.test(text)) hits.push("機密ラベル（マル秘 / 社外秘 / Confidential）");

  // パスワードリテラル
  if (/password\s*[:=]/i.test(text)) hits.push("パスワードリテラル（password: / password=）");

  return hits;
}

const hits = detect(target.scanText);

if (hits.length === 0) {
  // PII 無し：通常フローに委ねる
  process.exit(0);
}

// ---- deny 出力 ---------------------------------------------------------------
const reason =
  `[Belta PII 検知] 外部送信・書き込み（${target.channel}）のペイロードに機密情報が検出されたため、この操作をブロックしました。\n` +
  `検出: ${hits.join(" / ")}\n` +
  `送信前に該当箇所を除去・マスキングするか、外部送信が不要な手段に切り替えてください。`;

const output = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  },
};

process.stdout.write(JSON.stringify(output) + "\n");
process.exit(0);
