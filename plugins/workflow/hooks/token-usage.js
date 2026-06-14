#!/usr/bin/env node
//
// BELTA workflow plugin — トークン使用量ログフック（Stop）
//
// メインエージェントの応答が終わるたびに発火し、トランスクリプト（JSONL）から
// 各 assistant ターンの usage（input / output / cache_creation / cache_read）を
// 集計して、セッション単位のファイルに「上書き」保存する。
// 「どの処理にどれだけ使ったか」の可視化（/usage・token-dashboard.js）と、
// 5 時間ローリング窓の消費警告（session-start.js / repeat-detect.js）の材料になる。
//
// 設計方針:
// - セッション 1 ファイル（<home>/.belta/audit/tokens/<session_id>.json）に上書き。
//   append しないので Stop が何度発火してもログが肥大せず、二重計上もない。
// - 【schema_version 2 の要点】
//   (1) message.id でデデュープする。トランスクリプトはストリーミングの進行スナップ
//       ショットとして同一ターンを複数行（同じ message.id・同じ usage）記録するため、
//       全行をそのまま合算すると数倍に過大計上する（v1 の既知バグ）。同一 id は
//       「最後の行（完全形）」だけを採用する。
//   (2) by_model: モデル別の内訳（Opus 比率の可視化。利用制限の重い要因）。
//   (3) by_tool: ツール別の内訳（近似）。トークンはターン単位でしか記録されないため、
//       各ターンの usage をそのターンの tool_use 呼び出しへ均等按分する。厳密な帰属では
//       なく「何が重いか」の傾向を見るための目安。ツール呼び出しが無いターンは「応答のみ」。
//   (4) slots: 5 分粒度の時系列（unix 秒を 300 で丸めたキー → limit_equiv）。
//       5 時間ローリング消費の算出と日次トレンドの材料。直近分のみ保持（上限あり）。
//   (5) limit_equiv_token_estimate: 利用制限カウントに寄せた推計
//       （input + output + cache_creation + cache_read を満額で合算）。
//       billable_token_estimate（cache_read 0.1 掛けの API 換算トークン数）と併記する。
//       どちらも公式の制限カウントそのものではない（目安）。トークン数であり金額では
//       ないため、表示側では「課金」の語を避け「API換算（参考）」と表記する。
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

const SLOT_SECONDS = 300; // 時系列の粒度（5 分）
const MAX_SLOTS = 1000; // 保持スロット上限（5 分 × 1000 ≒ 83 時間。暴走防止）
const MAX_TOOL_KEYS = 100; // by_tool のキー上限（暴走防止）

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

// ツール呼び出しの表示ラベルを正規化する。
//   Skill → "Skill:<skill名>" / Task → "Task:<subagent_type>" /
//   mcp__<server>__<tool> → "<server>:<tool>"（server が UUID 風なら "mcp:<tool>"）
function toolLabel(block) {
  const name = String((block && block.name) || "").trim();
  if (!name) return "";
  const input = block && block.input && typeof block.input === "object" ? block.input : {};
  if (name === "Skill") {
    const skill = String(input.skill || "").trim();
    return skill ? `Skill:${skill}` : "Skill";
  }
  if (name === "Task") {
    const sub = String(input.subagent_type || input.subagentType || "").trim();
    return sub ? `Task:${sub}` : "Task";
  }
  const mcp = /^mcp__([^_].*?)__(.+)$/.exec(name);
  if (mcp) {
    const server = mcp[1];
    const tool = mcp[2];
    // server 名が UUID 風（連結環境で機械 ID になる）のときは読めないので落とす。
    if (/^[0-9a-f-]{20,}$/i.test(server)) return `mcp:${tool}`;
    return `${server}:${tool}`;
  }
  return name;
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

  // ---- パース + message.id デデュープ ----------------------------------------
  // 同一ターンはストリーミング途中のスナップショットとして複数行記録される
  // （usage 同一・content が伸びる）。同じ id の「最後の行」だけが完全形。
  const turnsById = new Map(); // dedupKey -> entry（最後の行を採用）
  let anonCounter = 0;
  for (const line of transcript.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const msg = entry && entry.message;
    const usage = msg && msg.usage;
    if (!usage || typeof usage !== "object") continue;
    const id = (msg.id && String(msg.id)) || (entry.requestId && String(entry.requestId)) || `__anon_${anonCounter++}`;
    turnsById.set(id, entry); // 後勝ち＝最後のスナップショットを採用
  }

  if (turnsById.size === 0) safeExit();

  // ---- 集計 -------------------------------------------------------------------
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const byModel = {}; // model -> { turns, input, output, cache_creation, cache_read, limit_equiv }
  const byTool = {}; // label -> { calls, limit_equiv }
  const slots = {}; // "<unix(300s)>" -> limit_equiv
  let turns = 0;

  for (const entry of turnsById.values()) {
    const msg = entry.message;
    const usage = msg.usage;
    turns += 1;

    const inTok = Number(usage.input_tokens) || 0;
    const outTok = Number(usage.output_tokens) || 0;
    const ccTok = Number(usage.cache_creation_input_tokens) || 0;
    const crTok = Number(usage.cache_read_input_tokens) || 0;
    totals.input_tokens += inTok;
    totals.output_tokens += outTok;
    totals.cache_creation_input_tokens += ccTok;
    totals.cache_read_input_tokens += crTok;

    // 利用制限カウントに寄せた推計（このターン分）。cache_read も満額で数える。
    const limitEquiv = inTok + outTok + ccTok + crTok;

    // モデル別
    const model = String(msg.model || "unknown").trim() || "unknown";
    const m = byModel[model] || {
      turns: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      limit_equiv: 0,
    };
    m.turns += 1;
    m.input_tokens += inTok;
    m.output_tokens += outTok;
    m.cache_creation_input_tokens += ccTok;
    m.cache_read_input_tokens += crTok;
    m.limit_equiv += limitEquiv;
    byModel[model] = m;

    // ツール別（近似按分）: このターンの tool_use 群へ均等割り。無ければ「応答のみ」。
    const content = Array.isArray(msg.content) ? msg.content : [];
    const labels = [];
    for (const block of content) {
      if (block && block.type === "tool_use") {
        const label = toolLabel(block);
        if (label) labels.push(label);
      }
    }
    const targets = labels.length ? labels : ["応答のみ"];
    const share = limitEquiv / targets.length;
    for (const label of targets) {
      const t = byTool[label] || { calls: 0, limit_equiv: 0 };
      if (labels.length) t.calls += 1;
      t.limit_equiv += share;
      byTool[label] = t;
    }

    // 5 分スロット時系列（timestamp が取れたターンのみ）
    const ts = Date.parse(entry.timestamp || "");
    if (Number.isFinite(ts)) {
      const slot = Math.floor(ts / 1000 / SLOT_SECONDS) * SLOT_SECONDS;
      slots[slot] = (Number(slots[slot]) || 0) + limitEquiv;
    }
  }

  // by_tool の按分値を整数へ丸め、キー数上限で軽量化（limit_equiv の小さい順に間引く）
  for (const k of Object.keys(byTool)) byTool[k].limit_equiv = Math.round(byTool[k].limit_equiv);
  {
    const keys = Object.keys(byTool);
    if (keys.length > MAX_TOOL_KEYS) {
      keys
        .sort((a, b) => byTool[a].limit_equiv - byTool[b].limit_equiv)
        .slice(0, keys.length - MAX_TOOL_KEYS)
        .forEach((k) => delete byTool[k]);
    }
  }
  // slots の上限丸め（古いスロットから捨てる）
  {
    const keys = Object.keys(slots).sort((a, b) => Number(a) - Number(b));
    if (keys.length > MAX_SLOTS) {
      keys.slice(0, keys.length - MAX_SLOTS).forEach((k) => delete slots[k]);
    }
  }

  // API 換算の概算トークン（cache_read は通常コストの ~1/10 として重み付け）。金額ではない。
  const billableEstimate =
    totals.input_tokens +
    totals.output_tokens +
    totals.cache_creation_input_tokens +
    Math.round(totals.cache_read_input_tokens * 0.1);

  // 利用制限カウントに寄せた推計（全種満額）。公式カウントそのものではない（目安）。
  const limitEquivEstimate =
    totals.input_tokens +
    totals.output_tokens +
    totals.cache_creation_input_tokens +
    totals.cache_read_input_tokens;

  const record = {
    schema_version: 2,
    session_id: sessionId,
    cwd: String(payload.cwd || ""),
    turns,
    usage: totals,
    billable_token_estimate: billableEstimate,
    limit_equiv_token_estimate: limitEquivEstimate,
    by_model: byModel,
    by_tool: byTool,
    slots,
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
