#!/usr/bin/env node
//
// BELTA workflow plugin — アバター数値の匿名化（GitHub Pages 公開用）
//
// avatar-stats.js のフル集計から、依頼文・PII・本名・画像・slug・時刻を一切含まない
// 「数値とバッジ id だけ」の公開用 JSON を、ホワイトリスト方式で生成する。
// docs/public/avatar-stats.json に出して既存 docs.yml（VitePress→Pages）に相乗りする。
//
// 使い方:
//   node avatar-anonymize.js [--in <stats.json>] [--dir <.beltaベース>] --out <public.json>
//                            [--include-name] [--include-image]
//     --in       avatar-stats.js --json の出力ファイル（省略時は --dir から再計算）
//     --out      出力先（必須）
//     --include-name   アバター名を含める（既定 OFF・要 LLM 確認）
//     --include-image  アバター画像を data URI で含める（既定 OFF・要 LLM 確認）
//
// 設計（fail-open / 機密の壁）:
//   - ホワイトリスト方式：出力に載せてよいキーだけを明示コピー。未知キーは捨てる。
//   - 仕上げに「許可していない文字列値が残っていないか」を検証し、残っていれば除外。
//   - Node.js のみ。fs/path/os。

const fs = require("fs");
const path = require("path");
const os = require("os");

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}

// ---- 引数 --------------------------------------------------------------------
const argv = process.argv.slice(2);
let inPath = null;
let outPath = null;
let dirOverride = null;
let includeName = false;
let includeImage = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--in") inPath = argv[++i];
  else if (a === "--out") outPath = argv[++i];
  else if (a === "--dir") dirOverride = argv[++i];
  else if (a === "--include-name") includeName = true;
  else if (a === "--include-image") includeImage = true;
}

if (!outPath) {
  process.stderr.write("--out が必要です\n");
  process.exit(1);
}

// ---- 入力（--in or 再計算）---------------------------------------------------
function loadStats() {
  if (inPath) {
    try {
      return JSON.parse(fs.readFileSync(inPath, "utf8"));
    } catch {
      return null;
    }
  }
  try {
    const { computeStats } = require(path.join(__dirname, "avatar-stats.js"));
    return computeStats({ dir: dirOverride || path.join(homeDir(), ".belta"), write: false });
  } catch {
    return null;
  }
}

// ---- 許容する skill_tree.stage の enum（安全な固定値のみ）--------------------
const STAGE_ENUM = new Set(["未解放", "解放", "育成中", "熟練"]);
const TIER_ENUM = new Set(["bronze", "silver", "gold"]);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso || ""));
  return m ? m[1] : "";
}

// ---- 匿名化（ホワイトリスト）-------------------------------------------------
function anonymize(stats) {
  const s = stats || {};
  const stats6 = s.stats || {};
  const tree = s.skill_tree || {};
  const raw = s.raw || {};

  const out = {
    schema_version: 1,
    anonymized: true,
    generated_date: dateOnly(s.generated_at),
    level: num(s.level),
    xp: num(s.xp),
    xp_into_level: num(s.xp_into_level),
    xp_for_next: num(s.xp_for_next),
    stage_index: num(s.stage_index),
    stats: {
      stamina: num(stats6.stamina),
      wisdom: num(stats6.wisdom),
      power: num(stats6.power),
      agility: num(stats6.agility),
      versatility: num(stats6.versatility),
      discipline: num(stats6.discipline),
    },
    streak: { current: num(s.streak && s.streak.current), max: num(s.streak && s.streak.max) },
    badges_earned: (s.badges && Array.isArray(s.badges.earned) ? s.badges.earned : [])
      .map((b) => ({ id: String(b.id || ""), tier: TIER_ENUM.has(b.tier) ? b.tier : "bronze" }))
      .filter((b) => /^[a-z0-9-]+$/.test(b.id)), // id は安全な slug のみ
    badges_total: (s.badges ? (s.badges.earned || []).length + (s.badges.locked || []).length : 0),
    skill_tree: {},
    counts: {
      active_days: num(raw.active_days),
      sessions: num(raw.sessions),
      rules: num(raw.rules && raw.rules.total),
      agents_adopted: num(raw.agents && raw.agents.adopted),
      skills_authored: num(raw.skills_authored),
      memory: num(raw.memory),
      usermodel_items: num(raw.usermodel_items),
    },
  };

  for (const k of ["notion", "slack", "github", "drive"]) {
    const node = tree[k] || {};
    out.skill_tree[k] = { hits: num(node.hits), stage: STAGE_ENUM.has(node.stage) ? node.stage : "未解放" };
  }

  // 明示オプトイン（要 LLM 確認）でのみ名前・画像を付与
  if (includeName || includeImage) {
    try {
      const beltaDir = dirOverride || path.join(homeDir(), ".belta");
      const yaml = fs.readFileSync(path.join(beltaDir, "avatar.yaml"), "utf8");
      const map = {};
      for (const line of yaml.split(/\r?\n/)) {
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim();
        let val = line.slice(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        map[key] = val;
      }
      if (includeName && map.name) out.name = String(map.name).slice(0, 40);
      if (includeImage && map.image_file) {
        const buf = fs.readFileSync(path.join(beltaDir, "avatar", map.image_file));
        const ext = path.extname(map.image_file).slice(1).toLowerCase();
        const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        out.image = `data:${mime};base64,${buf.toString("base64")}`;
      }
    } catch {
      /* 取得失敗時は付与しない */
    }
  }

  return out;
}

// ---- 安全検証：許可していない文字列値が残っていないか --------------------------
// 許可する文字列キー: generated_date, skill_tree.*.stage, badges_earned[].id/tier,
//   stage_index 以外は数値。name/image は明示オプトイン時のみ許容。
function verifyNoLeak(obj, includeName, includeImage) {
  const leaks = [];
  const allowedStringPaths = new Set(["generated_date"]);
  function walk(node, p) {
    if (node == null) return;
    if (typeof node === "string") {
      // skill_tree.*.stage / badges_earned[].id / .tier は enum 検証済み
      if (/^skill_tree\.[a-z]+\.stage$/.test(p)) return;
      if (/^badges_earned\.\d+\.(id|tier)$/.test(p)) return;
      if (p === "name" && includeName) return;
      if (p === "image" && includeImage) return;
      if (allowedStringPaths.has(p)) return;
      leaks.push(p);
      return;
    }
    if (typeof node === "boolean" || typeof node === "number") return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${p}.${i}`));
      return;
    }
    if (typeof node === "object") {
      for (const k of Object.keys(node)) walk(node[k], p ? `${p}.${k}` : k);
    }
  }
  walk(obj, "");
  return leaks;
}

// ---- メイン ------------------------------------------------------------------
const stats = loadStats();
if (!stats) {
  process.stderr.write("集計データを取得できませんでした（fail-open: 何も書きません）\n");
  process.exit(1);
}

const result = anonymize(stats);
const leaks = verifyNoLeak(result, includeName, includeImage);
if (leaks.length) {
  // 想定外の文字列が混入していたら安全側で落とす（公開しない）
  process.stderr.write(`匿名化検証に失敗（想定外の文字列値）: ${leaks.join(", ")}\n`);
  process.exit(2);
}

try {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = outPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(result, null, 2) + "\n");
  fs.renameSync(tmp, outPath);
} catch (e) {
  process.stderr.write(`書き込みに失敗: ${String(e)}\n`);
  process.exit(1);
}

process.stdout.write(JSON.stringify({ ok: true, out: outPath, leaks: 0, included_name: includeName, included_image: includeImage }) + "\n");
process.exit(0);
