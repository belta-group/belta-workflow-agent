#!/usr/bin/env node
//
// Belta workflow plugin — トークン使用量 集計スクリプト（Phase 0 実測データ用）
//
// hooks/token-usage.js が書き出したセッション単位ファイル
// （<home>/.belta/audit/tokens/<session_id>.json）を走査して合算し、
// Phase 0 経営承認資料に貼れる形（テーブル + 合計）で出力する。
//
// 使い方:
//   node scripts/aggregate-token-usage.js              # 既定: ~/.belta/audit/tokens/ を集計、表で表示
//   node scripts/aggregate-token-usage.js --md         # Markdown 出力（資料に貼る用）
//   node scripts/aggregate-token-usage.js --json       # 機械可読 JSON（合計のみ）
//   node scripts/aggregate-token-usage.js --dir <path> # 集計対象ディレクトリを差し替え
//
// 設計方針:
// - シェル非依存の Node.js（Claude Code 同梱 node でも素の node でも動く）。Mac / Windows 両対応。
//   ホームは環境変数から解決し、パスは path API で連結する（区切り直書きしない）。
// - 壊れた / 想定外のファイルは握りつぶしてスキップし、集計自体は止めない。

const fs = require("fs");
const path = require("path");
const os = require("os");

function resolveHome() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}

// ---- 引数パース ----------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = { md: false, json: false, dir: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--md") flags.md = true;
  else if (a === "--json") flags.json = true;
  else if (a === "--dir") flags.dir = argv[++i];
  else if (a === "-h" || a === "--help") {
    process.stdout.write(
      [
        "使い方: node scripts/aggregate-token-usage.js [--md|--json] [--dir <path>]",
        "  既定の集計対象: <home>/.belta/audit/tokens/",
      ].join("\n") + "\n"
    );
    process.exit(0);
  }
}

const targetDir = flags.dir || path.join(resolveHome(), ".belta", "audit", "tokens");

// ---- 読み込み -------------------------------------------------------------------
let files = [];
try {
  files = fs
    .readdirSync(targetDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith(".")); // .tmp 等は除外
} catch {
  process.stderr.write(
    `トークンログが見つかりません: ${targetDir}\n` +
      `（まだセッションが記録されていないか、--dir でパスを指定してください）\n`
  );
  process.exit(1);
}

const sessions = [];
for (const f of files) {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(targetDir, f), "utf8"));
    if (!rec || typeof rec !== "object" || !rec.usage) continue;
    sessions.push(rec);
  } catch {
    // 壊れたファイルはスキップ
  }
}

if (sessions.length === 0) {
  process.stderr.write(`集計可能なセッション記録が ${targetDir} にありません。\n`);
  process.exit(1);
}

// updated_at で安定ソート（古い→新しい）
sessions.sort((a, b) => (a.updated_at_unix || 0) - (b.updated_at_unix || 0));

// ---- 合算 -----------------------------------------------------------------------
const totals = {
  sessions: sessions.length,
  turns: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  billable_token_estimate: 0,
};
for (const s of sessions) {
  totals.turns += Number(s.turns) || 0;
  totals.input_tokens += Number(s.usage.input_tokens) || 0;
  totals.output_tokens += Number(s.usage.output_tokens) || 0;
  totals.cache_creation_input_tokens += Number(s.usage.cache_creation_input_tokens) || 0;
  totals.cache_read_input_tokens += Number(s.usage.cache_read_input_tokens) || 0;
  totals.billable_token_estimate += Number(s.billable_token_estimate) || 0;
}

// キャッシュヒット率: cache_read / (cache_read + cache_creation + 非キャッシュ input)
const cacheDenom =
  totals.cache_read_input_tokens + totals.cache_creation_input_tokens + totals.input_tokens;
const cacheHitRatio = cacheDenom > 0 ? totals.cache_read_input_tokens / cacheDenom : 0;

// ---- 出力 -----------------------------------------------------------------------
if (flags.json) {
  process.stdout.write(
    JSON.stringify(
      { source_dir: targetDir, cache_hit_ratio: Number(cacheHitRatio.toFixed(4)), totals },
      null,
      2
    ) + "\n"
  );
  process.exit(0);
}

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}
function shortId(id) {
  const s = String(id || "");
  return s.length > 12 ? s.slice(0, 12) : s;
}
function ymd(unix) {
  if (!unix) return "-";
  // タイムゾーン非依存・依存ライブラリなしで YYYY-MM-DD を作る（UTC 基準）。
  const d = new Date(Number(unix) * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

if (flags.md) {
  const lines = [];
  lines.push(`## トークン使用量 実測（Phase -1 ドッグフード）`);
  lines.push("");
  lines.push(`- 集計元: \`${targetDir}\``);
  lines.push(`- セッション数: ${fmt(totals.sessions)} / 総ターン数: ${fmt(totals.turns)}`);
  lines.push(`- キャッシュヒット率（read / 全入力）: ${(cacheHitRatio * 100).toFixed(1)}%`);
  lines.push("");
  lines.push(`| セッション | 日付 | ターン | input | output | cache作成 | cache読取 | 課金相当(概算) |`);
  lines.push(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const s of sessions) {
    lines.push(
      `| ${shortId(s.session_id)} | ${ymd(s.updated_at_unix)} | ${fmt(s.turns)} | ` +
        `${fmt(s.usage.input_tokens)} | ${fmt(s.usage.output_tokens)} | ` +
        `${fmt(s.usage.cache_creation_input_tokens)} | ${fmt(s.usage.cache_read_input_tokens)} | ` +
        `${fmt(s.billable_token_estimate)} |`
    );
  }
  lines.push(
    `| **合計** | | **${fmt(totals.turns)}** | **${fmt(totals.input_tokens)}** | ` +
      `**${fmt(totals.output_tokens)}** | **${fmt(totals.cache_creation_input_tokens)}** | ` +
      `**${fmt(totals.cache_read_input_tokens)}** | **${fmt(totals.billable_token_estimate)}** |`
  );
  lines.push("");
  lines.push(
    `> 課金相当(概算) = input + output + cache作成 + cache読取×0.1。正確な料金ではなく、` +
      `セッション間比較・総量把握のための目安。`
  );
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

// 既定: 簡易テキスト表
process.stdout.write(`集計元: ${targetDir}\n`);
process.stdout.write(`セッション数: ${fmt(totals.sessions)}  総ターン数: ${fmt(totals.turns)}\n`);
process.stdout.write(`キャッシュヒット率: ${(cacheHitRatio * 100).toFixed(1)}%\n`);
process.stdout.write("\n");
process.stdout.write(
  ["session".padEnd(14), "date".padEnd(12), "turns".padStart(6), "input".padStart(10), "output".padStart(10), "cache_rd".padStart(12), "billable".padStart(12)].join(" ") + "\n"
);
for (const s of sessions) {
  process.stdout.write(
    [
      shortId(s.session_id).padEnd(14),
      ymd(s.updated_at_unix).padEnd(12),
      fmt(s.turns).padStart(6),
      fmt(s.usage.input_tokens).padStart(10),
      fmt(s.usage.output_tokens).padStart(10),
      fmt(s.usage.cache_read_input_tokens).padStart(12),
      fmt(s.billable_token_estimate).padStart(12),
    ].join(" ") + "\n"
  );
}
process.stdout.write(
  [
    "TOTAL".padEnd(14),
    "".padEnd(12),
    fmt(totals.turns).padStart(6),
    fmt(totals.input_tokens).padStart(10),
    fmt(totals.output_tokens).padStart(10),
    fmt(totals.cache_read_input_tokens).padStart(12),
    fmt(totals.billable_token_estimate).padStart(12),
  ].join(" ") + "\n"
);
