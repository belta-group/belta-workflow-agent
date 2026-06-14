#!/usr/bin/env node
//
// BELTA workflow plugin — トークン消費の共有ユーティリティ
//
// token-usage.js（Stop）が書くセッション単位レコード（~/.belta/audit/tokens/*.json）を
// 読み側で扱う共通ロジック。session-start.js（SessionStart 警告）・repeat-detect.js
// （UserPromptSubmit 警告）・scripts/token-dashboard.js（可視化）から require される。
//
// 役割:
//   - sumRecentLimitEquiv: 直近 windowMs の「利用制限カウント相当」消費を全セッション
//     横断で合算する（schema_version 2 の slots を使う。v1 レコードは slots が無いので
//     対象外＝安全側に小さく出る）。ファイルは mtime で先に絞り、毎プロンプト発火でも
//     I/O を最小にする。
//   - readTokenWarnThreshold: config.yaml の token_5h_warn（5 時間窓の警告しきい値）を
//     読む。未設定・不正値は既定 70000（Max 5x の 5 時間枠の目安 ~88k の約 8 割）。
//
// 設計（cross-platform.md / フックの鉄則）:
//   - Node.js のみ（fs/path/os）。ホームは環境変数から解決。改行 /\r?\n/。
//   - fail-open: 読めない・壊れている入力はスキップし、呼び出し側を決して落とさない。

const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_5H_WARN = 70000;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

// 継続確認（長時間 / 多消費でユーザーへ「続けてよいか」を確認）の既定しきい値。
// いずれも config.yaml で変更でき、0 で無効。
const DEFAULT_CONTINUE_MINUTES = 30; // セッション初回プロンプトからの経過（分）
const DEFAULT_CONTINUE_TOKENS = 150000; // セッションの billable_token_estimate（API 換算・キャッシュ割引後）

function resolveHome() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}

function defaultTokensDir() {
  return path.join(resolveHome(), ".belta", "audit", "tokens");
}

// 直近 windowMs（既定 5 時間）の limit_equiv 消費を slots から合算する。
// now はテスト差し替え用（既定 Date.now()）。戻り値: 合算トークン数（整数）。
function sumRecentLimitEquiv(tokensDir, windowMs, now) {
  const dir = tokensDir || defaultTokensDir();
  const win = Number(windowMs) || FIVE_HOURS_MS;
  const nowMs = Number(now) || Date.now();
  const cutoffSec = Math.floor((nowMs - win) / 1000);

  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  } catch {
    return 0;
  }

  let sum = 0;
  for (const name of names) {
    const p = path.join(dir, name);
    // 窓より古いファイルは読まずに飛ばす（毎プロンプト発火の I/O を抑える）。
    try {
      if (fs.statSync(p).mtimeMs < nowMs - win) continue;
    } catch {
      continue;
    }
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    if (!rec || typeof rec !== "object" || !rec.slots || typeof rec.slots !== "object") continue;
    for (const [slot, v] of Object.entries(rec.slots)) {
      const slotSec = Number(slot);
      if (!Number.isFinite(slotSec) || slotSec < cutoffSec) continue;
      sum += Number(v) || 0;
    }
  }
  return Math.round(sum);
}

// config.yaml（flat YAML・依存なし）から整数キーを読む汎用ヘルパー。
//   - キーが無い・config が読めない → def（既定値）。
//   - 値があるが数値化できない → def。
//   - 0 以下 → 0（呼び出し側で「無効」として扱う）。
function readConfigInt(beltaDir, key, def) {
  const base = beltaDir || path.join(resolveHome(), ".belta");
  let text = "";
  try {
    text = fs.readFileSync(path.join(base, "config.yaml"), "utf8");
  } catch {
    return def;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    if (line.slice(0, idx).trim() !== key) continue;
    let val = line.slice(idx + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    const n = parseInt(val, 10);
    if (Number.isFinite(n)) return n > 0 ? n : 0; // 0 以下 = 無効
    return def;
  }
  return def;
}

// config.yaml の token_5h_warn を読む。0 以下は「警告無効」として 0 を返す。
function readTokenWarnThreshold(beltaDir) {
  return readConfigInt(beltaDir, "token_5h_warn", DEFAULT_5H_WARN);
}

// 継続確認のしきい値を読む。戻り値: { minutes, tokens }（どちらも 0 なら当該軸は無効）。
function readContinueThresholds(beltaDir) {
  return {
    minutes: readConfigInt(beltaDir, "continue_confirm_minutes", DEFAULT_CONTINUE_MINUTES),
    tokens: readConfigInt(beltaDir, "continue_confirm_tokens", DEFAULT_CONTINUE_TOKENS),
  };
}

// 当該セッションの「API 換算消費（billable_token_estimate）」を読む。
// token-usage.js（Stop）が書く <tokensDir>/<session_id>.json から取得する。
// セッションの実消費を一番素直に表す数値（キャッシュ読取を 0.1 掛けに割り引いた API 換算
// トークン数。limit_equiv はキャッシュ読取も満額で数えるため長いセッションで過大に膨らむ）。
// 記録が無い・読めない・未集計（Stop 前）は 0。
function readSessionBillable(tokensDir, sessionId) {
  const dir = tokensDir || defaultTokensDir();
  const sid = String(sessionId || "").trim();
  if (!sid) return 0;
  const safeName = sid.replace(/[^A-Za-z0-9._-]/g, "_");
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, `${safeName}.json`), "utf8"));
    const n = Number(rec && rec.billable_token_estimate);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

module.exports = {
  sumRecentLimitEquiv,
  readTokenWarnThreshold,
  readConfigInt,
  readContinueThresholds,
  readSessionBillable,
  defaultTokensDir,
  DEFAULT_5H_WARN,
  DEFAULT_CONTINUE_MINUTES,
  DEFAULT_CONTINUE_TOKENS,
  FIVE_HOURS_MS,
};
