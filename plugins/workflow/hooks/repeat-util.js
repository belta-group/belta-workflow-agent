#!/usr/bin/env node
//
// Belta workflow plugin — 反復検知の共有ユーティリティ
//
// SessionStart（セッションまたぎの反復）と UserPromptSubmit（同一セッション内の反復）の
// 両フックから使う、決定的な正規化・抽出・notes パースをまとめる。
//
// 設計方針:
//   - 反復の「検知」は決定的（正規化した文字列の一致）で行い、最低限の土台を保証する。
//     意味的な最終判断（領域ラベル付け・提案文）は LLM に委ねる（フックは指示を注入するだけ）。
//   - シェル非依存の Node.js のみ（cross-platform.md 準拠）。例外は呼び出し側で握りつぶす。

// 反復としてカウントしない定型的な短い返事・相槌。
const STOPWORDS = new Set([
  "はい", "いいえ", "ok", "おk", "了解", "りょうかい", "わかりました",
  "ありがとう", "ありがとうございます", "全て", "全部", "それで", "うん",
  "yes", "no", "続けて", "やって", "お願い",
]);

// 1 件の利用者発話 → 意図比較用の正規化キー。比較に不適なら "" を返す。
function normalizeRequest(text) {
  if (typeof text !== "string") return "";
  let t = text;
  // ハーネス注入タグ（利用者発話ではない）を除去。
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ");
  t = t.replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/g, " ");
  t = t.replace(/<local-command-[^>]*>[\s\S]*?<\/local-command-[^>]*>/g, " ");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.startsWith("/")) return ""; // スラッシュコマンドは対象外
  try {
    t = t.normalize("NFKC"); // 全角/半角などの表記ゆれを吸収
  } catch {
    /* normalize 非対応環境でも続行 */
  }
  t = t.toLowerCase();
  t = t.replace(/https?:\/\/\S+/g, " "); // URL は意図比較から除く
  // 記号・空白を除去（英数字・かな・漢字は残す。長音「ー」は語の一部なので残す）。
  t = t.replace(/[\s　、。.．，,！!？?：:；;「」『』（）()\[\]【】{}~〜・…_'"@#*＊\-]+/gu, "");
  // 末尾の依頼・丁寧表現を 1 回だけ剥がし、意図一致を取りやすくする。
  t = t.replace(/(してください|して下さい|おねがいします|お願いします|してほしい|してくれ|ちょうだい|させて|してね|して)$/u, "");
  if (!t || t.length < 3) return "";
  if (STOPWORDS.has(t)) return "";
  return t;
}

// トランスクリプト（JSONL 文字列）→ 「人間の利用者発話」の生テキスト配列（出現順）。
function extractUserTexts(transcript) {
  const out = [];
  if (typeof transcript !== "string") return out;
  for (const line of transcript.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let e;
    try {
      e = JSON.parse(s);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object") continue;
    if (e.isMeta || e.isCompactSummary || e.isSidechainEntry) continue;
    const m = e.message;
    if (!m || m.role !== "user") continue;
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      if (m.content.every((b) => b && b.type === "tool_result")) continue; // tool_result のみは発話でない
      text = m.content
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join(" ");
    } else {
      continue;
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

// notes 本文 → notes-record.js が書いた "[session:<id>] 依頼: a / b / c" 行を
// {sessionId, requests[]} の配列で返す（LLM が書いた他行は無視）。
function parseNotesSessions(notesText) {
  const rows = [];
  if (typeof notesText !== "string") return rows;
  for (const line of notesText.split(/\r?\n/)) {
    const m = line.match(/\[session:([^\]]+)\]\s*依頼:\s*(.+)$/);
    if (!m) continue;
    const sessionId = m[1].trim();
    const requests = m[2]
      .split(" / ")
      .map((r) => r.trim())
      .filter(Boolean);
    if (requests.length) rows.push({ sessionId, requests });
  }
  return rows;
}

module.exports = { normalizeRequest, extractUserTexts, parseNotesSessions, STOPWORDS };
