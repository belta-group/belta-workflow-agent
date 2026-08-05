#!/usr/bin/env node
//
// BELTA workflow plugin — セキュリティ監査ログ（共有ユーティリティ）
//
// フックが下した「ブロック / 確認」の判定を、日次の JSONL に 1 行追記する。
// インシデント調査（security-policies.md）の一次資料であり、
// 「いつ・どのツールで・何が理由で止まったか」だけを残す。
//
// 🔴 原則: ペイロード原文（＝機密そのもの）は絶対に書かない。
//    書いてよいのは判定メタ（決定 / ツール名 / 検出種別ラベル / セッション ID）だけ。
//    機密を止めるための記録が機密の複製になってはいけない。
//
// 保存先: <home>/.belta/audit/security/<YYYY-MM-DD>.jsonl
// 例外時は何もしない（fail-open。監査の失敗でセッションを止めない）。

const fs = require("fs");
const path = require("path");
const os = require("os");

const RETENTION_DAYS = 90;

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function securityDir() {
  return path.join(homeDir(), ".belta", "audit", "security");
}

// ローカル日付の YYYY-MM-DD（UTC ずれで日付が飛ばないよう getFullYear 系で組む）
function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 保持期間を過ぎた日次ログを掃除する（ファイル名の日付で判定）。
function pruneOld(dir, todayKey) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffKey = localDateKey(cutoff);
    for (const name of fs.readdirSync(dir)) {
      const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (!m) continue;
      if (m[1] < cutoffKey && m[1] !== todayKey) {
        try {
          fs.rmSync(path.join(dir, name), { force: true });
        } catch {
          /* 個別の削除失敗は無視 */
        }
      }
    }
  } catch {
    /* 掃除の失敗は無視 */
  }
}

/**
 * 監査イベントを 1 行追記する。
 *
 * @param {object} event
 * @param {"deny"|"ask"|"allow"} event.decision  下した判定
 * @param {string} event.hook                    判定したフック名（例 "pre-tool-use"）
 * @param {string} [event.tool]                  ツール名
 * @param {string} [event.rule]                  判定ルールの識別子（例 "pii" / "secret-file" / "skill-gate"）
 * @param {string[]} [event.labels]              検出種別のラベル（原文ではなく分類名のみ）
 * @param {string} [event.session]               セッション ID
 * @param {string} [event.subject]               対象の短い識別子（スキル名など。機密を含まないもののみ）
 * @returns {boolean} 追記できたか（失敗しても例外は投げない）
 */
function recordSecurityEvent(event) {
  try {
    const dir = securityDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    const now = new Date();
    const dateKey = localDateKey(now);

    // 機密を書かないため、渡された値のうち安全なフィールドだけを明示的に写す。
    const line = {
      at: now.toISOString(),
      decision: String(event.decision || ""),
      hook: String(event.hook || ""),
      tool: event.tool ? String(event.tool) : undefined,
      rule: event.rule ? String(event.rule) : undefined,
      labels: Array.isArray(event.labels) ? event.labels.map(String).slice(0, 12) : undefined,
      subject: event.subject ? String(event.subject).slice(0, 120) : undefined,
      session: event.session ? String(event.session) : undefined,
    };
    for (const k of Object.keys(line)) if (line[k] === undefined) delete line[k];

    fs.appendFileSync(path.join(dir, `${dateKey}.jsonl`), JSON.stringify(line) + "\n", "utf8");
    pruneOld(dir, dateKey);
    return true;
  } catch {
    return false; // fail-open
  }
}

module.exports = { recordSecurityEvent, securityDir, RETENTION_DAYS };
