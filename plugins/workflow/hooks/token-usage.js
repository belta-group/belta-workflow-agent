#!/usr/bin/env node
//
// Belta workflow plugin — トークン使用量ログフック（Stop）
//
// メインエージェントの応答が終わるたびに発火し、トランスクリプト（JSONL）から
// 各 assistant ターンの usage（input / output / cache_creation / cache_read）を
// 集計して、セッション単位のファイルに「上書き」保存する。
// Phase 0（経営承認）の実測データ用に、ドッグフード期間のトークン消費量を測る。
//
// 設計方針:
// - セッション 1 ファイル（<home>/.belta/audit/tokens/<session_id>.json）に上書き。
//   append しないので Stop が何度発火してもログが肥大せず、二重計上もない。
//   Phase 0 集計はこのディレクトリ配下を合算するだけ。
// - シェル非依存の Node.js（Claude Code 同梱の node）。Mac / Windows 両対応。
//   パスは path API で連結し、ホームは環境変数から解決する（区切り直書きしない）。
// - フックはセッションを止めてはいけない。入力不正・読み取り失敗など何が起きても
//   出力なしで exit 0 する（Stop フックの判断には一切介入しない）。
//
// 入力: stdin に Stop の JSON（session_id / transcript_path / cwd 等）。
// 出力: なし（常に exit 0）。

const fs = require("fs");
const path = require("path");
const os = require("os");

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

try {
  const payload = JSON.parse(readStdin() || "{}");

  const sessionId = String(payload.session_id || "").trim();
  const transcriptPath = String(payload.transcript_path || "").trim();
  if (!sessionId || !transcriptPath) safeExit();

  let transcript = "";
  try {
    transcript = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    safeExit();
  }

  // 集計対象: assistant メッセージの message.usage。各ターンの usage を素直に合算する。
  // input_tokens はキャッシュ読み取り分を含まない（cache_read_input_tokens が別計上）ため、
  // 4 種をそれぞれ足し込み、概算の課金相当は cache_read を 0.1 掛けで見積もる。
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let turns = 0;

  for (const line of transcript.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const usage = entry && entry.message && entry.message.usage;
    if (!usage || typeof usage !== "object") continue;
    turns += 1;
    totals.input_tokens += Number(usage.input_tokens) || 0;
    totals.output_tokens += Number(usage.output_tokens) || 0;
    totals.cache_creation_input_tokens += Number(usage.cache_creation_input_tokens) || 0;
    totals.cache_read_input_tokens += Number(usage.cache_read_input_tokens) || 0;
  }

  if (turns === 0) safeExit();

  // 課金相当の概算トークン（cache_read は通常コストの ~1/10 として重み付け）。
  // 正確な料金算出ではなく、セッション間比較・総量把握のための目安。
  const billableEstimate =
    totals.input_tokens +
    totals.output_tokens +
    totals.cache_creation_input_tokens +
    Math.round(totals.cache_read_input_tokens * 0.1);

  const record = {
    session_id: sessionId,
    cwd: String(payload.cwd || ""),
    turns,
    usage: totals,
    billable_token_estimate: billableEstimate,
    updated_at_unix: Math.floor(fs.statSync(transcriptPath).mtimeMs / 1000),
  };

  const home = resolveHome();
  if (!home) safeExit();
  const outDir = path.join(home, ".belta", "audit", "tokens");
  fs.mkdirSync(outDir, { recursive: true });

  // session_id をそのままファイル名に使うため、パス区切り等の混入を除去する。
  const safeName = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  const outPath = path.join(outDir, `${safeName}.json`);

  // 上書き保存（atomic 寄せ: 一時ファイルへ書いてから rename）。
  const tmpPath = path.join(outDir, `.${safeName}.json.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, outPath);
} catch {
  // 握りつぶす（セッションを止めない）。
}

safeExit();
