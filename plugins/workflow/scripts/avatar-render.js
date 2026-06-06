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

  // グリッド（同心六角形）
  let grid = "";
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    const poly = AXES.map((_, i) => pt(i, R * frac).map((v) => v.toFixed(1)).join(",")).join(" ");
    grid += `<polygon points="${poly}" fill="none" stroke="#2c3357" stroke-width="1"/>`;
  }
  // 軸線 + ラベル
  let axes = "";
  AXES.forEach((ax, i) => {
    const [ex, ey] = pt(i, R);
    axes += `<line x1="${cx}" y1="${cy}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#2c3357" stroke-width="1"/>`;
    const [lx, ly] = pt(i, R + 22);
    const val = stats6[ax.key] || 0;
    axes += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="#9aa3c7" font-size="13" text-anchor="middle" dominant-baseline="middle">${esc(ax.label)} ${val}</text>`;
  });
  // データ多角形
  const dataPoly = AXES.map((ax, i) => pt(i, (R * (stats6[ax.key] || 0)) / 100).map((v) => v.toFixed(1)).join(",")).join(" ");
  const data = `<polygon points="${dataPoly}" fill="rgba(124,196,255,0.30)" stroke="#7cc4ff" stroke-width="2"/>`;

  return `<svg viewBox="0 0 320 320" width="320" height="320" role="img" aria-label="ステータスレーダー">${grid}${axes}${data}</svg>`;
}

// ---- アバター（画像 or SVG フォールバック）+ 進化枠 --------------------------
function renderAvatarSvg(stageIndex, level) {
  // 段階で装飾が増える簡易キャラ（決定的）。画像未設定時のフォールバック。
  const hue = (level * 12) % 360;
  const body = `<circle cx="90" cy="100" r="52" fill="hsl(${hue},60%,55%)" stroke="#fff" stroke-width="3"/>`;
  const eyes = `<circle cx="74" cy="95" r="6" fill="#1a1f3a"/><circle cx="106" cy="95" r="6" fill="#1a1f3a"/>`;
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
  const hue = (stats.level * 12) % 360;
  const ring = `border:6px solid hsl(${hue},70%,60%); box-shadow:0 0 24px hsl(${hue},70%,55%);`;
  let inner;
  if (imageDataUri) {
    inner = `<img src="${imageDataUri}" alt="${esc(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`;
  } else {
    inner = renderAvatarSvg(stats.stage_index, stats.level);
  }
  // 段階に応じた周囲の装飾（画像でも進化が分かる）
  const crown = stats.stage_index >= 5 ? `<div class="crown">👑</div>` : stats.stage_index >= 4 ? `<div class="crown">✨</div>` : "";
  return `
    <div class="portrait-wrap">
      ${crown}
      <div class="portrait" style="${ring}">${inner}</div>
      <div class="stage-emoji">${esc(stats.stage_emoji || STAGE_EMOJI[0])}</div>
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
  const tierColor = { bronze: "#c8895a", silver: "#bfc6dd", gold: "#ffd84a" };
  const earned = (badges.earned || [])
    .map((b) => `<div class="badge earned" title="${esc(b.req)}"><span class="bemoji">${esc(b.emoji)}</span><span class="bname" style="color:${tierColor[b.tier] || "#fff"}">${esc(b.name)}</span></div>`)
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

// ---- HTML 全体 ---------------------------------------------------------------
function buildHtml(stats, meta, activeDays) {
  const xpInto = stats.xp_into_level || 0;
  const xpFor = stats.xp_for_next || 1;
  const pct = Math.max(0, Math.min(100, Math.round((xpInto / Math.max(1, xpFor)) * 100)));
  const s = stats.stats || {};
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(meta.name)} — 育成アバター</title>
<style>
  :root { --bg:#10142b; --panel:#1a2042; --panel2:#222a52; --txt:#e8ebff; --sub:#9aa3c7; --accent:#7cc4ff; }
  * { box-sizing:border-box; }
  body { margin:0; background:linear-gradient(160deg,#0c1024,#161b3d); color:var(--txt);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Kaku Gothic ProN",Meiryo,sans-serif; padding:24px; }
  .wrap { max-width:1000px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 16px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .panel { background:var(--panel); border:1px solid #2c3357; border-radius:16px; padding:20px; }
  .panel h2 { font-size:14px; color:var(--sub); margin:0 0 14px; letter-spacing:.04em; }
  .hero { display:flex; gap:24px; align-items:center; grid-column:1 / -1; }
  .portrait-wrap { position:relative; width:180px; flex:0 0 180px; text-align:center; }
  .portrait { width:160px; height:160px; border-radius:50%; overflow:hidden; margin:0 auto;
    display:flex; align-items:center; justify-content:center; background:#0d1130; }
  .crown { position:absolute; top:-14px; left:0; right:0; font-size:28px; }
  .stage-emoji { font-size:24px; margin-top:6px; }
  .hero-info { flex:1; }
  .name { font-size:28px; font-weight:700; }
  .lvline { font-size:15px; color:var(--sub); margin:4px 0 14px; }
  .lv { color:var(--accent); font-weight:700; font-size:18px; }
  .xpbar { height:14px; background:#0d1130; border-radius:8px; overflow:hidden; border:1px solid #2c3357; }
  .xpfill { height:100%; background:linear-gradient(90deg,#7cc4ff,#b78cff); width:${pct}%; }
  .xptext { font-size:12px; color:var(--sub); margin-top:6px; }
  .stat-list { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:14px; }
  .stat { background:var(--panel2); border-radius:10px; padding:8px 10px; }
  .stat .k { font-size:11px; color:var(--sub); }
  .stat .v { font-size:20px; font-weight:700; }
  .radar-wrap { text-align:center; }
  .heatmap { display:grid; grid-template-rows:repeat(7,12px); grid-auto-flow:column; grid-auto-columns:12px; gap:3px; }
  .cell { width:12px; height:12px; border-radius:3px; background:#222a52; }
  .cell.on { background:#7cc4ff; }
  .badge-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:10px; }
  .badge { background:var(--panel2); border-radius:10px; padding:10px; display:flex; align-items:center; gap:8px; }
  .badge.locked { opacity:.4; }
  .bemoji { font-size:20px; }
  .bname { font-size:12px; }
  .skill-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
  .skill { background:var(--panel2); border-radius:10px; padding:12px; text-align:center; border-bottom:4px solid #2c3357; }
  .skill.s1 { border-color:#5a7; } .skill.s2 { border-color:#7cc4ff; } .skill.s3 { border-color:#ffd84a; }
  .sname { font-weight:700; } .sstage { font-size:12px; color:var(--sub); margin:4px 0; } .shits { font-size:12px; color:var(--sub); }
  .foot { color:var(--sub); font-size:12px; margin-top:18px; text-align:center; }
  @media (max-width:720px){ .grid{grid-template-columns:1fr;} .hero{flex-direction:column;text-align:center;} }
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

    <div class="panel" style="grid-column:1 / -1;"><h2>実績バッジ（${(stats.badges.earned || []).length}/${(stats.badges.earned || []).length + (stats.badges.locked || []).length}）</h2>${renderBadges(stats.badges)}</div>
  </div>
  <div class="foot">生成: ${esc(stats.generated_at)} ／ このページはあなたのPC内（~/.belta/）にのみ保存され、外部送信されません。</div>
</div>
</body>
</html>
`;
}

function placeholderHtml(name) {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>${esc(name)} — 育成アバター</title></head>
<body style="background:#10142b;color:#e8ebff;font-family:sans-serif;padding:40px;">
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

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const tmp = outPath + ".tmp";
    fs.writeFileSync(tmp, html);
    fs.renameSync(tmp, outPath);
  } catch {
    return { ok: false, out: outPath };
  }
  return { ok: true, out: outPath };
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
