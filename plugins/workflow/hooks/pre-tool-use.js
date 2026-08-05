#!/usr/bin/env node
//
// BELTA workflow plugin — PreToolUse フック（3 役割）
//
// 役割 1: PII / 機密検知（deny）
//   外部送信・書き込み系のツール呼び出しの直前に発火し、ペイロードに
//   マイナンバー / クレジットカード / メールアドレス一括 / 機密ラベル
//   （マル秘・社外秘・Confidential）/ パスワードリテラルが含まれていれば
//   その呼び出しを deny する。
//
// 役割 2: 許可ダイアログのやさしい説明（ask）
//   PII が無く、かつ「書き込み・外部送信・確認が必要な操作」と判定できる
//   コマンド/ツールには、ノンエンジニアにも分かる平易な説明を添えて ask を返す。
//   Claude Code はこの permissionDecisionReason を許可確認ダイアログに表示するため、
//   「curl 127.0.0.1/hoge を実行してよいですか？」のような技術的な確認を
//   「お使いのパソコン内のプログラムにアクセスします。許可しますか？」へ翻訳できる。
//   説明の生成は hooks/explain-util.js（辞書 → 型分類 → LLM フォールバックの 3 段）に
//   委ねる。列挙（ハードコード）に頼らず未知コマンドも型レベルで意味づけし、純読み取り・
//   判定不能は素通し（read 系の allow を壊さない安全側）。対象コマンドは元々
//   settings.json の `ask`（毎回確認）なので確認回数は増えず、説明が足されるだけ。
//
// 役割 3: 機密ファイル読取ガード（deny）
//   `.env` / SSH 秘密鍵 / `*.pem` / クラウド認証情報 を読み出そうとする Bash コマンドと
//   Grep / Glob をブロックする。permissions の `Read(...)` deny は Claude Code が認識する
//   ファイルコマンド（cat / head / tail / sed）までしか届かず、awk / xxd / source /
//   リダイレクト / 自作スクリプト経由には効かない。判定は hooks/secret-file-util.js に
//   委ね、「読める道具」を列挙する代わりに「参照されているファイル」を見る。
//   `.env.example` 等のテンプレートと、正規表現リテラル（`"\.env"`）は素通し。
//
// Mac / Windows 両対応のためシェル非依存の Node.js で実装する
// （Claude Code 同梱の node ランタイムで動作。grep / sed に依存しない）。
//
// 入力: stdin に PreToolUse の JSON（tool_name / tool_input）。
// 出力: deny / ask 時のみ permissionDecision JSON を stdout に出す。
//       それ以外は無出力 exit 0（fail-open: 例外時もセッションを妨げない）。

const fs = require("fs");
const path = require("path");
const os = require("os");
const { buildAskReason, SUBPROCESS_GUARD } = require("./explain-util.js");
const { findSecretFileRefs } = require("./secret-file-util.js");
const { recordSecurityEvent } = require("./audit-log.js");

// LLM フォールバック（explain-util の claude -p）から本フックが再発火しても
// 無限再帰しないためのガード。子セッションのフックは即素通しで抜ける。
if (process.env[SUBPROCESS_GUARD] === "1") {
  process.exit(0);
}

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
const sessionId = String(payload.session_id || "");

// ============================================================================
// 役割 1 の対象判定：この呼び出しが「外部送信・書き込み系（PII 検知対象）」か
// ============================================================================
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

// 役割 1 対象なら { scanText, channel } を返す。対象外なら null。
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

// ============================================================================
// 役割 3：機密ファイル読取ガード
// ============================================================================
// 追加の例外サフィックス（config.yaml の env_guard_exceptions。読めなければ空）。
function readEnvGuardExceptions() {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const text = fs.readFileSync(path.join(home, ".belta", "config.yaml"), "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith("env_guard_exceptions")) continue;
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      let val = line.slice(idx + 1).trim();
      if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    /* 未設定・読めない → 例外なし */
  }
  return [];
}

// 機密ファイル参照を走査する対象テキストを返す（対象外なら null）。
//   Bash … コマンド文字列全体
//   Grep … path / glob（pattern は検索式なのでファイルパスとして扱わない）
//   Glob … pattern / path（Glob の pattern はパス glob そのもの）
function resolveSecretScanText() {
  if (/(^|_)Bash$/.test(toolName)) return String(toolInput.command || "");
  if (/(^|_)Grep$/.test(toolName)) {
    return [toolInput.path, toolInput.glob].filter(Boolean).map(String).join(" ");
  }
  if (/(^|_)Glob$/.test(toolName)) {
    return [toolInput.pattern, toolInput.path].filter(Boolean).map(String).join(" ");
  }
  return null;
}

// ============================================================================
// メイン：deny（最優先）→ ask（やさしい説明）→ 素通し
// ============================================================================
function emit(decision, reason, audit) {
  if (audit) recordSecurityEvent({ ...audit, decision, hook: "pre-tool-use", session: sessionId });
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }) + "\n"
  );
  process.exit(0);
}

try {
  const target = resolveTarget();

  // 役割 1: 外部送信・書き込み系で PII を検出 → deny（最優先）
  if (target) {
    const hits = detect(target.scanText);
    if (hits.length > 0) {
      emit(
        "deny",
        `[BELTA PII 検知] 外部送信・書き込み（${target.channel}）のペイロードに機密情報が検出されたため、この操作をブロックしました。\n` +
          `検出: ${hits.join(" / ")}\n` +
          `送信前に該当箇所を除去・マスキングするか、外部送信が不要な手段に切り替えてください。`,
        { tool: toolName, rule: "pii", labels: hits }
      );
    }
  }

  // 役割 3: 機密ファイル（.env / SSH 鍵 / *.pem / クラウド認証情報）の読取 → deny
  const secretScanText = resolveSecretScanText();
  if (secretScanText) {
    const secretHits = findSecretFileRefs(secretScanText, readEnvGuardExceptions());
    if (secretHits.length > 0) {
      emit(
        "deny",
        `[BELTA 機密ファイル保護] パスワードや鍵が入っているファイルを読み出そうとしたため、この操作をブロックしました。\n` +
          `対象: ${secretHits.join(" / ")}\n` +
          `中身を見ずに済む方法（設定名だけを扱う・サンプルファイル .env.example を見る・利用者に値を入れてもらう）に切り替えてください。\n` +
          `ファイル名を検索したいだけの場合は、パスではなく検索パターンとして指定してください（例: grep -rn "\\.env" docs/）。`,
        { tool: toolName, rule: "secret-file", labels: secretHits }
      );
    }
  }

  // 役割 2: 書き込み・外部送信・確認系と判定できれば、やさしい説明つき ask
  const askReason = buildAskReason(toolName, toolInput);
  // （役割 2 の ask は「毎回の書き込み確認」なので監査ログには残さない。
  //   監査に残すのは deny＝実際にブロックした事象だけ。ノイズで調査価値を薄めない。）
  if (askReason) emit("ask", askReason);

  // どちらでもない（読み取り系・判定不能）→ 素通し。通常の permission に委ねる。
  process.exit(0);
} catch {
  // fail-open: 例外時も無出力でセッションを妨げない
  process.exit(0);
}
