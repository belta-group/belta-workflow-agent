#!/usr/bin/env node
//
// Belta workflow plugin — 育成アバター ダッシュボード HTML 生成（決定的）
//
// avatar-stats.js の集計結果から、自己完結（CDN 依存ゼロ）の単一 HTML を生成する。
// レーダーチャート（インライン SVG）・稼働ヒートマップ（CSS grid）・実績バッジ・
// スキルツリー・進化するアバター（画像 or SVG/絵文字フォールバック）を含む RPG 育成風 UI。
//
// 使い方:
//   node avatar-render.js [--dir <.beltaベース>] [--out <path>] [--no-write-history]
//     --dir   .belta のベース（既定 <home>/.belta）
//     --out   出力先（既定 <belta>/dashboard.html）
//
// 設計（cross-platform.md / fail-open）:
//   - Node.js のみ。fs/path/os。画像は base64 data URI でインライン埋め込み（外部依存ゼロ）。
//   - OS の open コマンドは打たない（出力パスを呼び出し側に返すだけ）。
//   - 集計に失敗しても「データ不足」プレースホルダ HTML を出して exit 0。

const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");

const { computeStats, STAGE_EMOJI, STAGE_NAME } = require(path.join(__dirname, "avatar-stats.js"));

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}
function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

// ---- 小さな flat YAML パーサ（belta-init.js と同じ作法）-----------------------
function parseYaml(text) {
  const map = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    map[key] = val;
  }
  return map;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- 日付（UTC・依存なし）----------------------------------------------------
function todayStamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// ---- アバター画像 / 名前 ------------------------------------------------------
function loadAvatarMeta(beltaDir) {
  const meta = parseYaml(readText(path.join(beltaDir, "avatar.yaml")));
  const name = meta.name || "あいぼう";
  let imageDataUri = "";
  if (meta.image_file) {
    const imgPath = path.join(beltaDir, "avatar", meta.image_file);
    try {
      const buf = fs.readFileSync(imgPath);
      const ext = path.extname(meta.image_file).slice(1).toLowerCase();
      const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      imageDataUri = `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      imageDataUri = "";
    }
  }
  return { name, imageDataUri };
}

// ---- レーダーチャート（6 軸・インライン SVG）---------------------------------
const AXES = [
  { key: "stamina", label: "継続" },
  { key: "wisdom", label: "知識" },
  { key: "power", label: "自動化" },
  { key: "agility", label: "効率" },
  { key: "versatility", label: "多才" },
  { key: "discipline", label: "規律" },
];

function renderRadar(stats6) {
  const cx = 160;
  const cy = 150;
  const R = 110;
  const n = AXES.length;
  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, r) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];

  // グリッド（同心六角形）— EC-BELTA Tertiary 系の淡ピンク線
  let grid = "";
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    const poly = AXES.map((_, i) => pt(i, R * frac).map((v) => v.toFixed(1)).join(",")).join(" ");
    grid += `<polygon points="${poly}" fill="none" stroke="#f0d6e1" stroke-width="1"/>`;
  }
  // 軸線 + ラベル
  let axes = "";
  AXES.forEach((ax, i) => {
    const [ex, ey] = pt(i, R);
    axes += `<line x1="${cx}" y1="${cy}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#f0d6e1" stroke-width="1"/>`;
    const [lx, ly] = pt(i, R + 22);
    const val = stats6[ax.key] || 0;
    axes += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="#888" font-size="13" text-anchor="middle" dominant-baseline="middle">${esc(ax.label)} ${val}</text>`;
  });
  // データ多角形 — EC-BELTA Primary #d76492
  const dataPoly = AXES.map((ax, i) => pt(i, (R * (stats6[ax.key] || 0)) / 100).map((v) => v.toFixed(1)).join(",")).join(" ");
  const data = `<polygon points="${dataPoly}" fill="rgba(215,100,146,0.25)" stroke="#d76492" stroke-width="2"/>`;

  return `<svg viewBox="0 0 320 320" width="320" height="320" role="img" aria-label="ステータスレーダー">${grid}${axes}${data}</svg>`;
}

// ---- アバター（画像 or SVG フォールバック）+ 進化枠 --------------------------
function renderAvatarSvg(stageIndex, level) {
  // 段階で装飾が増える簡易キャラ（決定的）。画像未設定時のフォールバック。
  const hue = (level * 12) % 360;
  const body = `<circle cx="90" cy="100" r="52" fill="hsl(${hue},60%,55%)" stroke="#fff" stroke-width="3"/>`;
  const eyes = `<circle class="eye" cx="74" cy="95" r="6" fill="#1a1f3a"/><circle class="eye" cx="106" cy="95" r="6" fill="#1a1f3a"/>`;
  const mouth = `<path d="M72 118 Q90 132 108 118" stroke="#1a1f3a" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  let deco = "";
  if (stageIndex >= 1) deco += `<path d="M55 60 L90 30 L125 60 Z" fill="hsl(${hue},70%,45%)"/>`; // 帽子
  if (stageIndex >= 2) deco += `<rect x="40" y="150" width="100" height="14" rx="7" fill="hsl(${hue},65%,50%)"/>`; // マント
  if (stageIndex >= 3) deco += `<line x1="140" y1="60" x2="140" y2="150" stroke="#d8b24a" stroke-width="5" stroke-linecap="round"/><circle cx="140" cy="56" r="8" fill="#ffe07a"/>`; // 杖
  if (stageIndex >= 4) deco += `<circle cx="90" cy="100" r="66" fill="none" stroke="#ffe07a" stroke-width="2" stroke-dasharray="4 5" opacity="0.8"/>`; // オーラ
  if (stageIndex >= 5) deco += `<path d="M64 40 L74 56 L90 38 L106 56 L116 40 L112 64 L68 64 Z" fill="#ffd84a" stroke="#caa400" stroke-width="2"/>`; // 王冠
  return `<svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="アバター">${deco}${body}${eyes}${mouth}</svg>`;
}

function renderPortrait(stats, name, imageDataUri) {
  // リングは EC-BELTA Primary 系で固定し、レベルで光量だけ強くする（ブランド色を保つ）
  const glow = Math.min(0.45, 0.2 + stats.level * 0.01);
  const ring = `border:6px solid #eab7ca; box-shadow:0 0 24px rgba(215,100,146,${glow.toFixed(2)});`;
  let inner;
  if (imageDataUri) {
    inner = `<img src="${imageDataUri}" alt="${esc(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`;
  } else {
    inner = renderAvatarSvg(stats.stage_index, stats.level);
  }
  // 段階に応じた周囲の装飾（画像でも進化が分かる）
  const crown = stats.stage_index >= 5 ? `<div class="crown">👑</div>` : stats.stage_index >= 4 ? `<div class="crown">✨</div>` : "";
  // id はダッシュボード末尾のアニメーション JS（クリック反応・吹き出し）が参照する
  return `
    <div class="portrait-wrap" id="avatar" title="クリックすると反応するよ">
      <div class="bubble" id="bubble"></div>
      ${crown}
      <div class="portrait idle" id="portrait" style="${ring}">${inner}</div>
      <div class="stage-emoji">${esc(stats.stage_emoji || STAGE_EMOJI[0])}</div>
      <div class="tap-hint">クリックすると反応するよ</div>
    </div>`;
}

// ---- ヒートマップ（直近 16 週）-----------------------------------------------
function renderHeatmap(activeDays) {
  const set = new Set(activeDays || []);
  const weeks = 16;
  const totalDays = weeks * 7;
  const today = Date.parse(`${todayStamp()}T00:00:00Z`);
  const p = (x) => String(x).padStart(2, "0");
  const cells = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today - i * 86400000);
    const ds = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    const on = set.has(ds);
    cells.push(`<div class="cell ${on ? "on" : ""}" title="${ds}${on ? " 稼働" : ""}"></div>`);
  }
  return `<div class="heatmap">${cells.join("")}</div>`;
}

// ---- バッジ ------------------------------------------------------------------
function renderBadges(badges) {
  // 白背景で読めるよう各ティアを暗めに（gold は EC-BELTA $color-review-star #e9b83e の暗色派生）
  const tierColor = { bronze: "#a86b3f", silver: "#7e8a99", gold: "#bb8f1d" };
  const earned = (badges.earned || [])
    .map((b) => `<div class="badge earned" title="${esc(b.req)}"><span class="bemoji">${esc(b.emoji)}</span><span class="bname" style="color:${tierColor[b.tier] || "#3d3d3d"}">${esc(b.name)}</span></div>`)
    .join("");
  const locked = (badges.locked || [])
    .map((b) => `<div class="badge locked" title="条件: ${esc(b.req)}"><span class="bemoji">🔒</span><span class="bname">${esc(b.name)}</span></div>`)
    .join("");
  return `<div class="badge-grid">${earned}${locked}</div>`;
}

// ---- スキルツリー ------------------------------------------------------------
function renderSkillTree(tree) {
  const labels = { notion: "Notion", slack: "Slack", github: "GitHub", drive: "Drive" };
  const stageClass = { 未解放: "s0", 解放: "s1", 育成中: "s2", 熟練: "s3" };
  return Object.entries(labels)
    .map(([k, label]) => {
      const node = tree[k] || { hits: 0, stage: "未解放" };
      return `<div class="skill ${stageClass[node.stage] || "s0"}"><div class="sname">${esc(label)}</div><div class="sstage">${esc(node.stage)}</div><div class="shits">${node.hits} 回</div></div>`;
    })
    .join("");
}

// ---- 使用状況：ランキング（よく使う依頼 / コマンド）-------------------------
function renderTopList(items, unit) {
  if (!items || !items.length) {
    return `<div class="empty">まだ記録がありません（使うほど貯まります）。</div>`;
  }
  const rows = items
    .map(
      (it, i) => `<div class="rank-row">
        <span class="rank-no">${i + 1}</span>
        <span class="rank-label">${esc(it.label)}</span>
        <span class="rank-count">${Number(it.count) || 0}<span class="rank-unit">${esc(unit || "")}</span></span>
      </div>`
    )
    .join("");
  return `<div class="rank-list">${rows}</div>`;
}

// ---- 使用状況：エージェント使用比率（インライン SVG ドーナツ）---------------
// EC-BELTA カテゴリーカラー（_variables.scss）をチャートパレットとして採用
const DONUT_COLORS = ["#d76492", "#617cc3", "#84bd4a", "#efbe3a", "#f5a279", "#ef988e"];

function renderDonut(usage) {
  const items = (usage && usage.items) || [];
  const total = (usage && usage.total) || 0;
  if (!items.length || total <= 0) {
    return `<div class="empty">まだエージェントの起動記録がありません。<br/>専用エージェントを使うほど内訳が貯まります。</div>`;
  }
  const cx = 90;
  const cy = 90;
  const r = 64; // 円の半径
  const sw = 26; // ドーナツの太さ
  const C = 2 * Math.PI * r;
  let offset = 0;
  let segs = "";
  items.forEach((it, i) => {
    const frac = (Number(it.count) || 0) / total;
    const len = C * frac;
    const color = DONUT_COLORS[i % DONUT_COLORS.length];
    // 各セグメントを stroke-dasharray で描く（隙間を 1px 空けて視認性を上げる）
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
      stroke-dasharray="${Math.max(0, len - 1).toFixed(2)} ${(C - Math.max(0, len - 1)).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += len;
  });
  const svg = `<svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="エージェント使用比率">
    ${segs}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#3d3d3d" font-size="26" font-weight="700">${total}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="#888" font-size="11">起動（累計）</text>
  </svg>`;
  const legend = items
    .map(
      (it, i) => `<div class="lg-row">
        <span class="lg-dot" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></span>
        <span class="lg-name">${esc(it.name)}</span>
        <span class="lg-pct">${Number(it.pct) || 0}%</span>
      </div>`
    )
    .join("");
  return `<div class="donut-wrap"><div class="donut-svg">${svg}</div><div class="donut-legend">${legend}</div></div>`;
}

// ---- 使用状況：採用エージェント / 自作スキルのチップ ------------------------
function renderChips(names, emptyText) {
  if (!names || !names.length) return `<div class="empty">${esc(emptyText)}</div>`;
  return `<div class="chips">${names.map((n) => `<span class="chip">${esc(n)}</span>`).join("")}</div>`;
}

// ---- HTML 全体 ---------------------------------------------------------------
function buildHtml(stats, meta, activeDays) {
  const xpInto = stats.xp_into_level || 0;
  const xpFor = stats.xp_for_next || 1;
  const pct = Math.max(0, Math.min(100, Math.round((xpInto / Math.max(1, xpFor)) * 100)));
  const s = stats.stats || {};
  const usage = stats.usage || { top_requests: [], top_skills: [], top_commands: [], agent_usage: { total: 0, items: [] }, agents_adopted: [], skills_authored: [] };
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(meta.name)} — 育成アバター</title>
<style>
  /* EC-BELTA デザイントークン（app/assets/scss/base/_variables.scss が正。規約: .claude/rules/design.md）
     Primary #d76492 / Tertiary #f6e4eb / 背景 #fff6f7・#fffaf0 / テキスト #3d3d3d / サブ #888 */
  :root { --bg:#fff6f7; --panel:#fff; --panel2:#fff6f7; --txt:#3d3d3d; --sub:#888; --accent:#d76492;
    --border:#f3e4ea; --shadow:0 1px 4px rgba(0,0,0,.06); }
  * { box-sizing:border-box; }
  body { margin:0; background:linear-gradient(160deg,#fff6f7,#fffaf0); color:var(--txt);
    font-family:"Noto Sans JP","Yu Gothic","游ゴシック",yugothic,"游ゴシック体","ヒラギノ角ゴ Pro W3","メイリオ",sans-serif; padding:24px; }
  .wrap { max-width:1000px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 16px; }
  /* minmax(0,1fr) で各トラックの min-content 下限を外し、中身（固定幅 SVG / ヒートマップ）に
     引きずられてトラック幅が不均等／オーバーフローするのを防ぐ（左右パネルを常に等幅に保つ） */
  .grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:16px; align-items:stretch; }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:16px; padding:20px; box-shadow:var(--shadow); }
  .panel h2 { font-size:14px; color:var(--sub); margin:0 0 14px; letter-spacing:.04em; }
  .hero { display:flex; gap:24px; align-items:center; grid-column:1 / -1; }
  .portrait-wrap { position:relative; width:180px; flex:0 0 180px; text-align:center; }
  .portrait { width:160px; height:160px; border-radius:50%; overflow:hidden; margin:0 auto;
    display:flex; align-items:center; justify-content:center; background:#f6e4eb; }
  .crown { position:absolute; top:-14px; left:0; right:0; font-size:28px; animation:crown-bob 2.4s ease-in-out infinite; }
  .stage-emoji { font-size:24px; margin-top:6px; }
  /* ---- アバターアニメーション（常時アイドル＋クリック反応） ---- */
  .portrait-wrap { cursor:pointer; user-select:none; -webkit-user-select:none; }
  .portrait { will-change:transform; }
  @keyframes idle-sway { 0%,100%{transform:rotate(-2.5deg) translateY(0);} 50%{transform:rotate(2.5deg) translateY(-5px);} }
  .portrait.idle { animation:idle-sway 3.4s ease-in-out infinite; }
  @keyframes crown-bob { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-4px);} }
  @keyframes spin-once { from{transform:rotate(0);} to{transform:rotate(360deg);} }
  .portrait.anim-spin { animation:spin-once .9s cubic-bezier(.45,.05,.35,1.15) 1; }
  @keyframes dokidoki { 0%,100%{transform:scale(1);} 12%{transform:scale(1.14);} 24%{transform:scale(.98);} 36%{transform:scale(1.12);} 50%{transform:scale(1);} }
  .portrait.anim-dokidoki { animation:dokidoki 1.1s ease-in-out 1; }
  @keyframes wakuwaku { 0%,100%{transform:translateY(0) scale(1,1);} 12%{transform:translateY(2px) scale(1.06,.92);}
    30%{transform:translateY(-20px) scale(.96,1.06);} 48%{transform:translateY(0) scale(1.05,.94);}
    62%{transform:translateY(-10px) scale(.98,1.02);} 78%{transform:translateY(0) scale(1.02,.98);} }
  .portrait.anim-wakuwaku { animation:wakuwaku 1.1s ease-in-out 1; }
  @keyframes talk-bob { 0%,100%{transform:scale(1,1);} 25%{transform:scale(1.03,.97);} 50%{transform:scale(.98,1.02);} 75%{transform:scale(1.02,.98);} }
  .portrait.anim-talk { animation:talk-bob .55s ease-in-out 4; }
  /* SVG フォールバックの目はときどきまばたきする */
  @keyframes blink { 0%,92%,100%{transform:scaleY(1);} 96%{transform:scaleY(.1);} }
  .eye { transform-origin:center; transform-box:fill-box; animation:blink 4.6s ease-in-out infinite; }
  /* 吹き出し（話す） */
  .bubble { position:absolute; bottom:calc(100% + 10px); left:50%; transform:translateX(-50%); background:#fff;
    border:2px solid #eab7ca; border-radius:14px; padding:8px 12px; font-size:13px; line-height:1.5; color:var(--txt);
    box-shadow:var(--shadow); white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .25s, transform .25s; z-index:3; }
  .bubble::after { content:""; position:absolute; top:100%; left:50%; margin-left:-6px; border:6px solid transparent; border-top-color:#eab7ca; }
  .bubble.show { opacity:1; transform:translateX(-50%) translateY(-4px); }
  .tap-hint { font-size:11px; color:var(--sub); margin-top:4px; }
  /* クリック時に舞う絵文字パーティクル */
  .pop { position:absolute; left:50%; top:40%; font-size:20px; pointer-events:none; z-index:2; animation:pop-float 1.1s ease-out forwards; }
  @keyframes pop-float { 0%{opacity:0; transform:translate(-50%,0) scale(.6);} 15%{opacity:1;}
    100%{opacity:0; transform:translate(calc(-50% + var(--dx,0px)),-90px) scale(1.15) rotate(var(--rot,0deg));} }
  /* 動きを減らす設定（OS）では装飾アニメーションを止める */
  @media (prefers-reduced-motion: reduce) {
    .portrait.idle, .portrait[class*="anim-"], .crown, .eye, .pop { animation:none !important; }
  }
  .hero-info { flex:1; }
  .name { font-size:28px; font-weight:700; }
  .lvline { font-size:15px; color:var(--sub); margin:4px 0 14px; }
  .lv { color:var(--accent); font-weight:700; font-size:18px; }
  .xpbar { height:14px; background:#f6e4eb; border-radius:8px; overflow:hidden; border:1px solid #f0d6e1; }
  .xpfill { height:100%; background:linear-gradient(90deg,#d76492,#d97da2); width:${pct}%; }
  .xptext { font-size:12px; color:var(--sub); margin-top:6px; }
  .stat-list { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:14px; }
  .stat { background:var(--panel2); border-radius:10px; padding:8px 10px; }
  .stat .k { font-size:11px; color:var(--sub); }
  .stat .v { font-size:20px; font-weight:700; }
  /* レーダーはパネル内で天地中央寄せ（ヒートマップ側と高さが揃っても間延びしない） */
  .radar-wrap { text-align:center; display:flex; flex-direction:column; }
  .radar-wrap svg { width:100%; height:auto; max-width:320px; margin:auto; }
  /* ヒートマップは 16 週 × 7 日をパネル幅いっぱいに敷き詰める（固定 12px だと余白だらけで
     ステータス側とバランスが崩れるため、セルを可変幅＝正方形にして横いっぱいに広げる） */
  .heatmap { display:grid; grid-template-columns:repeat(16, minmax(0,1fr)); grid-template-rows:repeat(7, auto); grid-auto-flow:column; gap:4px; width:100%; }
  .cell { aspect-ratio:1; border-radius:3px; background:#f6e4eb; }
  .cell.on { background:#d76492; }
  .badge-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:10px; }
  .badge { background:var(--panel2); border-radius:10px; padding:10px; display:flex; align-items:center; gap:8px; }
  .badge.locked { opacity:.4; }
  .bemoji { font-size:20px; }
  .bname { font-size:12px; }
  .skill-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(100px,1fr)); gap:10px; }
  .skill { background:var(--panel2); border-radius:10px; padding:12px; text-align:center; border-bottom:4px solid #f0d6e1; }
  /* 解放=妊娠中グリーン / 育成中=Primary / 熟練=レビュー星ゴールド（EC-BELTA カテゴリ・実色） */
  .skill.s1 { border-color:#84bd4a; } .skill.s2 { border-color:#d76492; } .skill.s3 { border-color:#e9b83e; }
  .sname { font-weight:700; } .sstage { font-size:12px; color:var(--sub); margin:4px 0; } .shits { font-size:12px; color:var(--sub); }
  .foot { color:var(--sub); font-size:12px; margin-top:18px; text-align:center; }
  .empty { color:var(--sub); font-size:13px; line-height:1.6; }
  .sub-h { font-size:12px; color:var(--sub); margin-bottom:8px; }
  /* よく使う依頼 / コマンドのランキング */
  .rank-list { display:flex; flex-direction:column; }
  .rank-row { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--border); }
  .rank-row:last-child { border-bottom:none; }
  .rank-no { flex:0 0 22px; font-weight:700; color:var(--accent); text-align:center; }
  .rank-label { flex:1; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .rank-count { font-weight:700; font-size:18px; white-space:nowrap; }
  .rank-unit { font-size:11px; color:var(--sub); font-weight:400; margin-left:2px; }
  /* エージェント使用比率ドーナツ */
  .donut-wrap { display:flex; gap:18px; align-items:center; flex-wrap:wrap; }
  .donut-svg { flex:0 0 180px; max-width:100%; }
  .donut-svg svg { width:100%; height:auto; max-width:180px; }
  .donut-legend { flex:1; min-width:160px; display:flex; flex-direction:column; gap:8px; }
  .lg-row { display:flex; align-items:center; gap:8px; font-size:13px; }
  .lg-dot { width:12px; height:12px; border-radius:3px; flex:0 0 12px; }
  .lg-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lg-pct { color:var(--sub); font-weight:700; }
  /* チップ（採用エージェント / 自作スキル） */
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { background:var(--panel2); border:1px solid #f0d6e1; border-radius:999px; padding:5px 12px; font-size:13px; }
  /* タブレット: 2列は維持しつつ hero を縦並びに */
  @media (max-width:900px){ .hero{flex-direction:column;text-align:center;} .hero-info{width:100%;} }
  /* スマホ: 1列・余白圧縮・stat 2列 */
  @media (max-width:600px){
    body{padding:14px;}
    .grid{grid-template-columns:1fr;}
    .panel{padding:16px;}
    .stat-list{grid-template-columns:repeat(2,1fr);}
    .name{font-size:24px;}
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>🎮 育成アバター ダッシュボード</h1>
  <div class="grid">
    <div class="panel hero">
      ${renderPortrait(stats, meta.name, meta.imageDataUri)}
      <div class="hero-info">
        <div class="name">${esc(meta.name)}</div>
        <div class="lvline"><span class="lv">Lv.${stats.level}</span> ${esc(stats.stage)} ／ 連続稼働 ${stats.streak.current} 日（最長 ${stats.streak.max}）</div>
        <div class="xpbar"><div class="xpfill"></div></div>
        <div class="xptext">XP ${stats.xp}（このレベル ${xpInto} / ${xpFor}）</div>
        <div class="stat-list">
          <div class="stat"><div class="k">継続</div><div class="v">${s.stamina || 0}</div></div>
          <div class="stat"><div class="k">知識</div><div class="v">${s.wisdom || 0}</div></div>
          <div class="stat"><div class="k">自動化</div><div class="v">${s.power || 0}</div></div>
          <div class="stat"><div class="k">効率</div><div class="v">${s.agility || 0}</div></div>
          <div class="stat"><div class="k">多才</div><div class="v">${s.versatility || 0}</div></div>
          <div class="stat"><div class="k">規律</div><div class="v">${s.discipline || 0}</div></div>
        </div>
      </div>
    </div>

    <div class="panel radar-wrap"><h2>ステータス</h2>${renderRadar(s)}</div>

    <div class="panel"><h2>稼働ヒートマップ（直近16週）</h2>${renderHeatmap(activeDays)}
      <div class="xptext" style="margin-top:12px;">
        ルール ${stats.raw.rules.total} ／ 採用エージェント ${stats.raw.agents.adopted} ／ 自作スキル ${stats.raw.skills_authored} ／ 記憶 ${stats.raw.memory}
      </div>
    </div>

    <div class="panel" style="grid-column:1 / -1;"><h2>スキルツリー（ツール習熟）</h2><div class="skill-grid">${renderSkillTree(stats.skill_tree)}</div></div>

    <div class="panel"><h2>よく使うスキル（累計）</h2>${renderTopList(usage.top_skills, " 回")}</div>

    <div class="panel"><h2>よく使う依頼（直近の蓄積）</h2>${renderTopList(usage.top_requests, " 回")}</div>

    <div class="panel"><h2>よく使うコマンド（累計）</h2>${renderTopList(usage.top_commands, " 回")}</div>

    <div class="panel"><h2>エージェント 使用比率</h2>${renderDonut(usage.agent_usage)}</div>

    <div class="panel"><h2>あなた専用の担当者</h2>
      <div class="sub-h">採用した専用エージェント</div>${renderChips(usage.agents_adopted, "まだ採用した専用エージェントはありません。")}
      <div class="sub-h" style="margin-top:12px;">自作スキル</div>${renderChips(usage.skills_authored, "まだ自作スキルはありません。")}
    </div>

    <div class="panel" style="grid-column:1 / -1;"><h2>実績バッジ（${(stats.badges.earned || []).length}/${(stats.badges.earned || []).length + (stats.badges.locked || []).length}）</h2>${renderBadges(stats.badges)}</div>
  </div>
  <div class="foot">生成: ${esc(stats.generated_at)} ／ このページはあなたのPC内（~/.belta/）にのみ保存され、外部送信されません。</div>
</div>
${buildAvatarScript(stats, meta)}
</body>
</html>
`;
}

// ---- アバターのアニメーション JS（生成 HTML に同梱・外部依存ゼロ）------------
// 揺れる（常時）・1回転・話す（吹き出し）・ドキドキ・ワクワクのクリック反応。
// Math.random はブラウザ側の演出にのみ使う（HTML 生成自体は決定的なまま）。
function buildAvatarScript(stats, meta) {
  const cfg = {
    name: meta.name,
    level: stats.level,
    stage: stats.stage,
    streak: (stats.streak && stats.streak.current) || 0,
    nextBadge: ((stats.badges && stats.badges.locked) || []).length
      ? stats.badges.locked[0].name
      : "",
  };
  // </script> 等の混入を防ぐ（名前は利用者入力）
  const cfgJson = JSON.stringify(cfg).replace(/</g, "\\u003c");
  return `<script>
(function () {
  var cfg = ${cfgJson};
  var wrap = document.getElementById("avatar");
  var p = document.getElementById("portrait");
  var bubble = document.getElementById("bubble");
  if (!wrap || !p) return;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  var sayTimer = null;
  function say(text, ms) {
    if (!bubble) return;
    bubble.textContent = text;
    bubble.classList.add("show");
    clearTimeout(sayTimer);
    sayTimer = setTimeout(function () { bubble.classList.remove("show"); }, ms || 2400);
  }

  function burst(emoji, n) {
    if (reduced) return;
    for (var i = 0; i < n; i++) {
      var s = document.createElement("span");
      s.className = "pop";
      s.textContent = emoji;
      s.style.setProperty("--dx", (Math.random() * 120 - 60).toFixed(0) + "px");
      s.style.setProperty("--rot", (Math.random() * 60 - 30).toFixed(0) + "deg");
      s.style.animationDelay = (Math.random() * 0.25).toFixed(2) + "s";
      wrap.appendChild(s);
      (function (el) {
        el.addEventListener("animationend", function () { el.remove(); });
        setTimeout(function () { el.remove(); }, 2000); // 保険
      })(s);
    }
  }

  var busy = false;
  function play(kind) {
    if (reduced) return; // 動きを減らす設定では吹き出しだけ
    if (busy) return;
    busy = true;
    p.classList.remove("idle");
    void p.offsetWidth; // reflow でアニメーションを確実に再生
    p.classList.add("anim-" + kind);
    var finished = false;
    var done = function () {
      if (finished) return;
      finished = true;
      p.classList.remove("anim-" + kind);
      p.classList.add("idle");
      busy = false;
    };
    p.addEventListener("animationend", done, { once: true });
    setTimeout(done, 3000); // 保険（タブ非表示等で animationend が落ちても復帰）
  }

  var talkLines = [
    cfg.name + "だよ！呼んだ？",
    "いま Lv." + cfg.level + "（" + cfg.stage + "）まで育ったよ！",
    "今日も一緒にがんばろうね！",
    "使うほど、もっと育つよ🌱",
    cfg.streak > 1 ? "連続 " + cfg.streak + " 日稼働中！えらい！" : "毎日使うと連続稼働が伸びるよ",
  ];
  if (cfg.nextBadge) talkLines.push("次は「" + cfg.nextBadge + "」を狙おう！");

  var acts = [
    function () { play("talk"); say(pick(talkLines), 2800); },
    function () { play("dokidoki"); burst("💗", 5); say("ドキドキ…！", 1800); },
    function () { play("wakuwaku"); burst("✨", 6); say("ワクワク！", 1800); },
    function () { play("spin"); say("くるん！", 1500); },
  ];

  // シャッフルした順に一巡してから再シャッフル（同じ反応の連発を避ける）
  var queue = [];
  wrap.addEventListener("click", function () {
    if (busy) return;
    if (!queue.length) {
      queue = acts.slice();
      for (var i = queue.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = queue[i]; queue[i] = queue[j]; queue[j] = t;
      }
    }
    queue.shift()();
  });

  // 開いたときのあいさつ
  var greetings = [
    "おかえり！待ってたよ",
    "やっほー！" + cfg.name + "だよ",
    "きょうも会えてうれしい！",
  ];
  setTimeout(function () {
    say(pick(greetings), 3000);
    play("wakuwaku");
    burst("✨", 4);
  }, 600);
})();
</scr` + `ipt>`;
}

function placeholderHtml(name) {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>${esc(name)} — 育成アバター</title></head>
<body style="background:#fff6f7;color:#3d3d3d;font-family:'Noto Sans JP','Yu Gothic',Meiryo,sans-serif;padding:40px;">
<h1>🥚 ${esc(name)} はまだ眠っています</h1>
<p>使い込むほどアバターが育ちます。もう少しデータが貯まったら <code>/avatar</code> を実行してください。</p>
</body></html>`;
}

// ---- メイン ------------------------------------------------------------------
function render(opts = {}) {
  const beltaDir = opts.dir || path.join(homeDir(), ".belta");
  const outPath = opts.out || path.join(beltaDir, "dashboard.html");
  const meta = loadAvatarMeta(beltaDir);

  let html;
  try {
    const stats = computeStats({ dir: beltaDir, write: opts.write !== false });
    const history = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(beltaDir, "avatar", "history.json"), "utf8"));
      } catch {
        return { active_days: [] };
      }
    })();
    html = buildHtml(stats, meta, history.active_days || []);
  } catch {
    html = placeholderHtml(meta.name);
  }

  // クリックで開ける file:// URL（クロスプラットフォーム。Windows のバックスラッシュ
  // やスペース・日本語も pathToFileURL が正しくエンコードする）。
  let fileUrl = "";
  try {
    fileUrl = pathToFileURL(outPath).href;
  } catch {
    fileUrl = "";
  }
  // そのまま会話に貼れる Markdown リンク（呼び出し側はこれを 1 行で出力するだけでよい。
  // 生パスを書かせないための「コピペ完成品」）。
  const markdown = fileUrl ? `[🎮 ダッシュボードを開く](${fileUrl})` : "";

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

if (require.main === module) {
  const argv = process.argv.slice(2);
  let dir = null;
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") dir = argv[++i];
    else if (a === "--out") out = argv[++i];
  }
  const r = render({ dir, out });
  process.stdout.write(JSON.stringify(r) + "\n");
  process.exit(0);
}

module.exports = { render, buildHtml };
