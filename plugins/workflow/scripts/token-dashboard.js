#!/usr/bin/env node
//
// Belta workflow plugin — トークン消費ダッシュボード（決定的）
//
// hooks/token-usage.js が書き出すセッション単位レコード（~/.belta/audit/tokens/*.json）
// を集計し、「どの処理（ツール・スキル・モデル）にどれだけトークンを使ったか」を
// 自己完結（CDN 依存ゼロ）の単一 HTML に可視化する。Claude の利用制限
// （5 時間ローリング窓）に「一瞬で当たる」事故の自己診断が目的。
//
// 使い方:
//   node token-dashboard.js [--json|--md] [--dir <.beltaベース>] [--out <path>]
//     --json  機械可読 JSON（集計のみ。HTML は生成しない）
//     --md    人間可読サマリ（会話表示用。HTML は生成しない）
//     --dir   .belta のベース（既定 <home>/.belta）。テスト用
//     --out   HTML 出力先（既定 <belta>/token-dashboard.html）
//
// import 利用:
//   const { computeTokenStats, render } = require(".../token-dashboard.js");
//
// 設計（cross-platform.md / avatar-render.js と同じ作法）:
//   - Node.js のみ（fs/path/os/url）。インライン CSS/SVG。外部依存ゼロ。
//   - OS の open コマンドは打たない（{ok, out, url, markdown} を返すだけ）。
//   - fail-open: 記録が無い・壊れていても「データ不足」HTML を出して exit 0。
//   - schema_version 1（旧）レコードも totals に合算する（内訳・時系列は v2 のみ）。
//
// 【数値の意味（重要）】
//   - limit_equiv（利用制限相当）: input+output+cache作成+cache読取 を満額合算。
//     Claude の利用制限カウントに「寄せた」推計で、公式カウントそのものではない。
//   - billable（API換算）: cache読取を 0.1 掛けで合算。API 従量課金で使った場合の
//     カウント感覚の目安。**トークン数であり金額ではない**。Pro/Max は定額制のため
//     消費が増えても追加請求は発生しない（表示ラベルでも「金額」と誤読させない）。
//   - ツール別内訳: トークンはターン単位でしか記録されないため、各ターンの消費を
//     そのターンのツール呼び出しへ均等按分した近似（「何が重いか」の傾向用）。

const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");

const { sumRecentLimitEquiv, readTokenWarnThreshold, FIVE_HOURS_MS } = require(
  path.join(__dirname, "..", "hooks", "tokens-util.js")
);

const TREND_DAYS = 14; // 日次トレンドの表示日数
const TOP_TOOLS = 10; // ツール別内訳の表示件数
const TOP_SESSIONS = 10; // セッション表の表示件数

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}
function listFiles(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}
// 大きな数の短縮表記（軸ラベル・バー注記用）: 1234567 → "1.2M"
function short(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return String(Math.round(v));
}
function ymdUtc(unixSec) {
  const d = new Date(Number(unixSec) * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// レコードから limit_equiv を取る（v1 には無いので usage から再計算）。
function recordLimitEquiv(rec) {
  if (Number.isFinite(Number(rec.limit_equiv_token_estimate))) {
    return Number(rec.limit_equiv_token_estimate);
  }
  const u = rec.usage || {};
  return (
    (Number(u.input_tokens) || 0) +
    (Number(u.output_tokens) || 0) +
    (Number(u.cache_creation_input_tokens) || 0) +
    (Number(u.cache_read_input_tokens) || 0)
  );
}

// ---- 集計コア（fail-open・決して throw を漏らさない）-------------------------
function computeTokenStats(opts = {}) {
  const beltaDir = opts.dir || path.join(homeDir(), ".belta");
  const tokensDir = path.join(beltaDir, "audit", "tokens");

  const totals = {
    sessions: 0,
    turns: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    billable_token_estimate: 0,
    limit_equiv_token_estimate: 0,
  };
  const byModel = {}; // model -> { turns, limit_equiv }
  const byTool = {}; // label -> { calls, limit_equiv }
  const daily = {}; // "YYYY-MM-DD" -> limit_equiv
  const sessions = [];
  let v2count = 0;

  for (const f of listFiles(tokensDir)) {
    if (!f.endsWith(".json") || f.startsWith(".")) continue;
    const rec = readJson(path.join(tokensDir, f));
    if (!rec || typeof rec !== "object" || !rec.usage) continue;

    const u = rec.usage;
    const limitEquiv = recordLimitEquiv(rec);
    totals.sessions++;
    totals.turns += Number(rec.turns) || 0;
    totals.input_tokens += Number(u.input_tokens) || 0;
    totals.output_tokens += Number(u.output_tokens) || 0;
    totals.cache_creation_input_tokens += Number(u.cache_creation_input_tokens) || 0;
    totals.cache_read_input_tokens += Number(u.cache_read_input_tokens) || 0;
    totals.billable_token_estimate += Number(rec.billable_token_estimate) || 0;
    totals.limit_equiv_token_estimate += limitEquiv;

    const isV2 = Number(rec.schema_version) >= 2;
    if (isV2) v2count++;

    // モデル別（v2 のみ）
    if (isV2 && rec.by_model && typeof rec.by_model === "object") {
      for (const [model, m] of Object.entries(rec.by_model)) {
        if (!m || typeof m !== "object") continue;
        const cur = byModel[model] || { turns: 0, limit_equiv: 0 };
        cur.turns += Number(m.turns) || 0;
        cur.limit_equiv += Number(m.limit_equiv) || 0;
        byModel[model] = cur;
      }
    }
    // ツール別（v2 のみ）
    if (isV2 && rec.by_tool && typeof rec.by_tool === "object") {
      for (const [label, t] of Object.entries(rec.by_tool)) {
        if (!t || typeof t !== "object") continue;
        const cur = byTool[label] || { calls: 0, limit_equiv: 0 };
        cur.calls += Number(t.calls) || 0;
        cur.limit_equiv += Number(t.limit_equiv) || 0;
        byTool[label] = cur;
      }
    }
    // 日次トレンド: v2 は slots から日へ畳む。v1 は updated_at の日へ全量計上（近似）。
    if (isV2 && rec.slots && typeof rec.slots === "object") {
      for (const [slot, v] of Object.entries(rec.slots)) {
        const sec = Number(slot);
        if (!Number.isFinite(sec)) continue;
        const day = ymdUtc(sec);
        daily[day] = (Number(daily[day]) || 0) + (Number(v) || 0);
      }
    } else if (Number(rec.updated_at_unix)) {
      const day = ymdUtc(rec.updated_at_unix);
      daily[day] = (Number(daily[day]) || 0) + limitEquiv;
    }

    sessions.push({
      session_id: String(rec.session_id || f.replace(/\.json$/, "")),
      updated_at_unix: Number(rec.updated_at_unix) || 0,
      turns: Number(rec.turns) || 0,
      limit_equiv: limitEquiv,
      billable: Number(rec.billable_token_estimate) || 0,
      cache_read: Number(u.cache_read_input_tokens) || 0,
      schema_version: Number(rec.schema_version) || 1,
    });
  }

  const cacheDenom =
    totals.cache_read_input_tokens + totals.cache_creation_input_tokens + totals.input_tokens;
  const cacheHitRatio = cacheDenom > 0 ? totals.cache_read_input_tokens / cacheDenom : 0;

  // 直近 5 時間ローリング消費としきい値（警告フックと同じ計算）。
  const rolling5h = sumRecentLimitEquiv(tokensDir, FIVE_HOURS_MS);
  const threshold5h = readTokenWarnThreshold(beltaDir);

  // 表示用に並べ替え
  const modelRows = Object.entries(byModel)
    .map(([model, m]) => ({ model, ...m }))
    .sort((a, b) => b.limit_equiv - a.limit_equiv);
  const toolRows = Object.entries(byTool)
    .map(([label, t]) => ({ label, ...t }))
    .sort((a, b) => b.limit_equiv - a.limit_equiv);
  sessions.sort((a, b) => b.limit_equiv - a.limit_equiv);

  // 直近 TREND_DAYS 日のトレンド（データの無い日は 0 で埋める）
  const trend = [];
  {
    const todaySec = Math.floor(Date.now() / 1000);
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const day = ymdUtc(todaySec - i * 86400);
      trend.push({ day, limit_equiv: Math.round(Number(daily[day]) || 0) });
    }
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_dir: tokensDir,
    found: totals.sessions > 0,
    v2_sessions: v2count,
    totals,
    cache_hit_ratio: Number(cacheHitRatio.toFixed(4)),
    rolling_5h: { limit_equiv: rolling5h, threshold: threshold5h },
    by_model: modelRows,
    by_tool: toolRows,
    trend,
    sessions,
  };
}

// ---- HTML 部品 ----------------------------------------------------------------
// EC-BELTA カテゴリーカラー（_variables.scss）をチャートパレットとして採用
const BAR_COLORS = ["#d76492", "#617cc3", "#84bd4a", "#efbe3a", "#f5a279", "#ef988e", "#4f5978"];

// 横棒ランキング（モデル別・ツール別 共用）
function renderHBars(rows, opts = {}) {
  if (!rows.length) {
    return `<div class="empty">まだ内訳の記録がありません。新しいバージョンのフックが記録した分（今後のセッション）から貯まります。</div>`;
  }
  const max = Math.max(...rows.map((r) => r.limit_equiv), 1);
  const total = rows.reduce((a, r) => a + r.limit_equiv, 0) || 1;
  return (
    `<div class="hbars">` +
    rows
      .map((r, i) => {
        const pct = Math.round((r.limit_equiv / total) * 100);
        const w = Math.max(1, Math.round((r.limit_equiv / max) * 100));
        const color = opts.highlightOpus && /opus/i.test(r.label || r.model || "")
          ? "#ce004e" /* EC-BELTA 更年期ケアカテゴリの濃ピンク＝「重い」強調 */
          : BAR_COLORS[i % BAR_COLORS.length];
        const sub = opts.subText ? opts.subText(r) : "";
        return `<div class="hbar-row">
          <div class="hbar-label" title="${esc(r.label || r.model)}">${esc(r.label || r.model)}</div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${w}%;background:${color}"></div></div>
          <div class="hbar-val">${short(r.limit_equiv)} <span class="hbar-pct">${pct}%</span>${sub}</div>
        </div>`;
      })
      .join("") +
    `</div>`
  );
}

// 日次トレンド（縦棒・インライン SVG）
function renderTrend(trend) {
  if (!trend.length || trend.every((t) => t.limit_equiv === 0)) {
    return `<div class="empty">まだ日別の記録がありません。使うほど貯まります。</div>`;
  }
  const W = 640;
  const H = 200;
  const padL = 46;
  const padB = 28;
  const padT = 14;
  const innerW = W - padL - 10;
  const innerH = H - padT - padB;
  const max = Math.max(...trend.map((t) => t.limit_equiv), 1);
  const bw = innerW / trend.length;

  let bars = "";
  trend.forEach((t, i) => {
    const h = Math.round((t.limit_equiv / max) * innerH);
    const x = padL + i * bw + bw * 0.15;
    const y = padT + innerH - h;
    bars += `<rect x="${x.toFixed(1)}" y="${y}" width="${(bw * 0.7).toFixed(1)}" height="${h}" rx="3" fill="#d76492"><title>${esc(t.day)}: ${fmt(t.limit_equiv)}</title></rect>`;
    // 日ラベルは 2 日おき（MM-DD）
    if (i % 2 === 0) {
      bars += `<text x="${(x + bw * 0.35).toFixed(1)}" y="${H - 8}" fill="#888" font-size="10" text-anchor="middle">${esc(t.day.slice(5))}</text>`;
    }
  });
  // Y 軸目盛（0 / 半分 / 最大）
  let axis = "";
  for (const frac of [0, 0.5, 1]) {
    const y = padT + innerH - innerH * frac;
    axis += `<line x1="${padL}" y1="${y}" x2="${W - 10}" y2="${y}" stroke="#f3e4ea" stroke-width="1"/>`;
    axis += `<text x="${padL - 6}" y="${y + 4}" fill="#888" font-size="10" text-anchor="end">${short(max * frac)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="日別トークン消費">${axis}${bars}</svg>`;
}

// 5 時間ゲージ
function renderGauge(rolling) {
  const used = Number(rolling.limit_equiv) || 0;
  const threshold = Number(rolling.threshold) || 0;
  if (threshold <= 0) {
    return `<div class="empty">警告しきい値が無効化されています（config.yaml の token_5h_warn が 0）。直近5時間の消費: ${fmt(used)}</div>`;
  }
  const pct = Math.min(100, Math.round((used / threshold) * 100));
  // 超過=EC-BELTA Caution / 接近=レビュー星ゴールド / 余裕=妊娠中グリーン
  const color = pct >= 100 ? "#e40101" : pct >= 70 ? "#e9b83e" : "#84bd4a";
  const note =
    pct >= 100
      ? "しきい値を超えています。少し休ませるか、重い処理を後回しにすると安全です。"
      : pct >= 70
        ? "しきい値に近づいています。大きなファイルの全文読み込み等を控えると安心です。"
        : "今のところ余裕があります。";
  return `
    <div class="gauge-wrap">
      <div class="gauge-track"><div class="gauge-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="gauge-meta"><b>${fmt(used)}</b> / しきい値 ${fmt(threshold)}（${pct}%） — ${esc(note)}</div>
    </div>`;
}

// セッション表
function renderSessions(sessions) {
  if (!sessions.length) return `<div class="empty">まだセッションの記録がありません。</div>`;
  const rows = sessions
    .slice(0, TOP_SESSIONS)
    .map(
      (s) => `<tr>
        <td class="mono">${esc(String(s.session_id).slice(0, 12))}</td>
        <td>${esc(s.updated_at_unix ? ymdUtc(s.updated_at_unix) : "-")}</td>
        <td class="num">${fmt(s.turns)}</td>
        <td class="num">${fmt(s.limit_equiv)}</td>
        <td class="num">${fmt(s.billable)}</td>
      </tr>`
    )
    .join("");
  return `<table class="sess">
    <thead><tr><th>セッション</th><th>日付</th><th class="num">ターン</th><th class="num">制限相当</th><th class="num">API換算（参考）</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ---- HTML 全体 ---------------------------------------------------------------
function buildHtml(stats) {
  const t = stats.totals;
  const cachePct = (stats.cache_hit_ratio * 100).toFixed(1);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>トークン消費ダッシュボード</title>
<style>
  /* EC-BELTA デザイントークン（app/assets/scss/base/_variables.scss が正）
     Primary #d76492 / Tertiary #f6e4eb / 背景 #fff6f7・#fffaf0 / テキスト #3d3d3d / サブ #888 */
  :root { --bg:#fff6f7; --panel:#fff; --panel2:#fff6f7; --txt:#3d3d3d; --sub:#888; --accent:#d76492;
    --border:#f3e4ea; --shadow:0 1px 4px rgba(0,0,0,.06); }
  * { box-sizing:border-box; }
  body { margin:0; background:linear-gradient(160deg,#fff6f7,#fffaf0); color:var(--txt);
    font-family:"Noto Sans JP","Yu Gothic","游ゴシック",yugothic,"游ゴシック体","ヒラギノ角ゴ Pro W3","メイリオ",sans-serif; padding:24px; }
  .wrap { max-width:1000px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 6px; }
  .lede { color:var(--sub); font-size:13px; margin:0 0 16px; }
  .grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:16px; align-items:stretch; }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:16px; padding:20px; box-shadow:var(--shadow); }
  .panel h2 { font-size:14px; color:var(--sub); margin:0 0 14px; letter-spacing:.04em; }
  .span2 { grid-column:1 / -1; }
  .empty { color:var(--sub); font-size:13px; line-height:1.6; }
  /* サマリカード */
  .stat-list { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
  .stat { background:var(--panel2); border-radius:10px; padding:10px 12px; }
  .stat .k { font-size:11px; color:var(--sub); }
  .stat .v { font-size:20px; font-weight:700; }
  .stat .s { font-size:11px; color:var(--sub); }
  /* 5h ゲージ */
  .gauge-track { height:18px; background:#f6e4eb; border:1px solid #f0d6e1; border-radius:10px; overflow:hidden; }
  .gauge-fill { height:100%; }
  .gauge-meta { font-size:13px; color:var(--sub); margin-top:8px; }
  .gauge-meta b { color:var(--txt); }
  /* 横棒 */
  .hbars { display:flex; flex-direction:column; gap:8px; }
  /* バー列は minmax(48px,1fr) で最低幅を保証する。固定 1fr だと、パネルが狭い中間幅
     （2 カラム表示のままウィンドウが狭い場合）でラベル・数値列に食われて 0px に潰れ、
     バーが丸ごと消える。ラベル列も minmax(0,180px) で譲れるようにしておく。 */
  .hbar-row { display:grid; grid-template-columns:minmax(0,180px) minmax(48px,1fr) minmax(0,130px); gap:10px; align-items:center; }
  .hbar-label { font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .hbar-track { height:14px; background:#f6e4eb; border-radius:7px; overflow:hidden; }
  .hbar-fill { height:100%; border-radius:7px; }
  .hbar-val { font-size:13px; font-weight:700; white-space:nowrap; }
  .hbar-pct { color:var(--sub); font-weight:400; font-size:11px; }
  .hbar-sub { color:var(--sub); font-weight:400; font-size:11px; }
  /* セッション表 */
  .sess { width:100%; border-collapse:collapse; font-size:13px; }
  .sess th, .sess td { padding:8px 6px; border-bottom:1px solid var(--border); text-align:left; }
  .sess th { color:var(--sub); font-weight:400; font-size:11px; }
  .sess .num { text-align:right; }
  .mono { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; }
  .note { background:var(--panel2); border-radius:10px; padding:12px 14px; font-size:12px; color:var(--sub); line-height:1.7; }
  .foot { color:var(--sub); font-size:12px; margin-top:18px; text-align:center; }
  @media (max-width:600px){
    body{padding:14px;}
    .grid{grid-template-columns:1fr;}
    .panel{padding:16px;}
    .stat-list{grid-template-columns:repeat(2,1fr);}
    .hbar-row{grid-template-columns:minmax(0,110px) minmax(40px,1fr) minmax(0,110px);}
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>⚡ トークン消費ダッシュボード</h1>
  <p class="lede">あなたの秘書（このエージェント）が、どの処理にどれだけトークンを使ったかの見える化。利用制限（5時間ごとの上限）対策の自己診断用。</p>
  <div class="grid">

    <div class="panel span2"><h2>直近5時間の消費（利用制限の目安ゲージ）</h2>
      ${renderGauge(stats.rolling_5h)}
      <div class="note" style="margin-top:12px;">このゲージは<b>このエージェントのセッション分だけ</b>の推計です。Claude の公式の利用制限カウントそのものではありません（他プロジェクトや claude.ai での利用分は含まれません）。しきい値は設定ファイル（<span class="mono">~/.belta/config.yaml</span> の <span class="mono">token_5h_warn</span>）で変更できます。</div>
    </div>

    <div class="panel span2"><h2>累計サマリ</h2>
      <div class="stat-list">
        <div class="stat"><div class="k">制限相当（累計）</div><div class="v">${short(t.limit_equiv_token_estimate)}</div><div class="s">${fmt(t.limit_equiv_token_estimate)} トークン</div></div>
        <div class="stat"><div class="k">API換算トークン（参考・累計）</div><div class="v">${short(t.billable_token_estimate)}</div><div class="s">${fmt(t.billable_token_estimate)} トークン</div></div>
        <div class="stat"><div class="k">キャッシュヒット率</div><div class="v">${cachePct}%</div><div class="s">高いほど効率的</div></div>
        <div class="stat"><div class="k">セッション</div><div class="v">${fmt(t.sessions)}</div><div class="s">記録された会話の数</div></div>
        <div class="stat"><div class="k">ターン</div><div class="v">${fmt(t.turns)}</div><div class="s">応答の回数</div></div>
        <div class="stat"><div class="k">出力トークン</div><div class="v">${short(t.output_tokens)}</div><div class="s">${fmt(t.output_tokens)}</div></div>
      </div>
      <div class="note" style="margin-top:12px;">この画面の数値は<b>すべてトークン数（使った量の個数）で、金額ではありません</b>。Pro/Max プランは月額定額制のため、消費が増えても追加請求は発生しません（利用制限に当たりやすくなるだけ）。「API換算」は、もし API 従量課金で使った場合のカウント感覚の参考値（キャッシュ読取を 0.1 掛けで合算したトークン数）です。</div>
    </div>

    <div class="panel span2"><h2>日別の消費（直近${TREND_DAYS}日・制限相当）</h2>${renderTrend(stats.trend)}</div>

    <div class="panel"><h2>モデル別の内訳（重い順）</h2>
      ${renderHBars(stats.by_model.map((m) => ({ label: m.model, limit_equiv: m.limit_equiv })), { highlightOpus: true })}
      <div class="note" style="margin-top:12px;">Opus 系（濃いピンク）は Sonnet 系より制限消費が重いモデルです。比率が高いほど制限に早く当たります。</div>
    </div>

    <div class="panel"><h2>処理（ツール・スキル）別の内訳 上位${TOP_TOOLS}</h2>
      ${renderHBars(stats.by_tool.slice(0, TOP_TOOLS).map((x) => ({ label: x.label, limit_equiv: x.limit_equiv })))}
      <div class="note" style="margin-top:12px;">トークンは応答ターン単位でしか記録されないため、各ターンの消費をそのターンのツール呼び出しへ均等按分した<b>近似値</b>です（「何が重いか」の傾向用）。「応答のみ」はツールを使わない通常の応答分。</div>
    </div>

    <div class="panel span2"><h2>消費の大きいセッション 上位${TOP_SESSIONS}</h2>${renderSessions(stats.sessions)}</div>

  </div>
  <div class="foot">生成: ${esc(stats.generated_at)} ／ 集計元: <span class="mono">${esc(stats.source_dir)}</span> ／ このページはあなたのPC内（~/.belta/）にのみ保存され、外部送信されません。</div>
</div>
</body>
</html>
`;
}

function placeholderHtml() {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>トークン消費ダッシュボード</title></head>
<body style="background:#fff6f7;color:#3d3d3d;font-family:'Noto Sans JP','Yu Gothic',Meiryo,sans-serif;padding:40px;">
<h1>⚡ まだ記録がありません</h1>
<p>セッションを使うとトークン消費の記録が貯まります。少し使ってから <code>/usage</code> を実行してください。</p>
</body></html>`;
}

// ---- メイン ------------------------------------------------------------------
function render(opts = {}) {
  const beltaDir = opts.dir || path.join(homeDir(), ".belta");
  const outPath = opts.out || path.join(beltaDir, "token-dashboard.html");

  let html;
  let stats = null;
  try {
    stats = computeTokenStats({ dir: beltaDir });
    html = stats.found ? buildHtml(stats) : placeholderHtml();
  } catch {
    html = placeholderHtml();
  }

  let fileUrl = "";
  try {
    fileUrl = pathToFileURL(outPath).href;
  } catch {
    fileUrl = "";
  }
  const markdown = fileUrl ? `[⚡ トークン消費ダッシュボードを開く](${fileUrl})` : "";

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const tmp = outPath + ".tmp";
    fs.writeFileSync(tmp, html);
    fs.renameSync(tmp, outPath);
  } catch {
    return { ok: false, out: outPath, url: fileUrl, markdown };
  }
  return { ok: true, out: outPath, url: fileUrl, markdown };
}

// ---- CLI ---------------------------------------------------------------------
function runCli() {
  const argv = process.argv.slice(2);
  let dir = null;
  let out = null;
  let mode = "render"; // render | json | md
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") dir = argv[++i];
    else if (a === "--out") out = argv[++i];
    else if (a === "--json") mode = "json";
    else if (a === "--md") mode = "md";
    else if (a === "-h" || a === "--help") {
      process.stdout.write("使い方: node token-dashboard.js [--json|--md] [--dir <path>] [--out <path>]\n");
      process.exit(0);
    }
  }

  if (mode === "json" || mode === "md") {
    let stats;
    try {
      stats = computeTokenStats({ dir });
    } catch {
      stats = { schema_version: 1, found: false, totals: {}, by_model: [], by_tool: [], trend: [], sessions: [] };
    }
    if (mode === "json") {
      process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
      process.exit(0);
    }
    // --md: 会話貼り付け用の短いサマリ
    const t = stats.totals || {};
    const lines = [
      `# ⚡ トークン消費サマリ`,
      "",
      `- 直近5時間（制限相当の推計）: ${fmt((stats.rolling_5h || {}).limit_equiv || 0)} / しきい値 ${fmt((stats.rolling_5h || {}).threshold || 0)}`,
      `- 累計: 制限相当 ${fmt(t.limit_equiv_token_estimate)} ／ API換算（参考） ${fmt(t.billable_token_estimate)} ／ キャッシュヒット率 ${((stats.cache_hit_ratio || 0) * 100).toFixed(1)}%`,
      `- セッション ${fmt(t.sessions)} ／ ターン ${fmt(t.turns)}`,
      `- ※数値はすべてトークン数で、金額ではありません（Pro/Max は定額制・追加請求なし）`,
    ];
    if ((stats.by_model || []).length) {
      lines.push(`- モデル別: ` + stats.by_model.map((m) => `${m.model} ${short(m.limit_equiv)}`).join(" / "));
    }
    if ((stats.by_tool || []).length) {
      lines.push(`- 重い処理 上位3: ` + stats.by_tool.slice(0, 3).map((x) => `${x.label} ${short(x.limit_equiv)}`).join(" / "));
    }
    process.stdout.write(lines.join("\n") + "\n");
    process.exit(0);
  }

  const r = render({ dir, out });
  process.stdout.write(JSON.stringify(r) + "\n");
  process.exit(0);
}

if (require.main === module) {
  runCli();
}

module.exports = { computeTokenStats, buildHtml, render };
