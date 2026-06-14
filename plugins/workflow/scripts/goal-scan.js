#!/usr/bin/env node
//
// BELTA workflow plugin — ゴール走査エンジン（goal スキル用）
//
// `~/.belta/goals/` のゴールファイル（<slug>.md）を決定的に走査し、進捗集計・
// 次ステップ・stale（停滞）検知の「材料」を JSON で stdout に出す。
// ステップ分解・実行・進捗の書き込みは LLM スキル（skills/goal/）が行う。
// このスクリプトは一切書き込まない（読み取り専用）。
//
// 設計方針（notes-scan.js と同じ鉄則）:
//   - シェル非依存の Node.js のみ。Mac / Windows 両対応。パスは path API、
//     ホームは環境変数から解決、改行は /\r?\n/ で両対応。
//   - パーサは hooks/goal-util.js を再利用する（session-start.js の再開検知と
//     「ゴールの読み方」をブレさせない）。
//   - fail-open: goals が無い・壊れていても落とさず、空の結果 JSON を出して exit 0。
//
// 使い方:
//   node goal-scan.js [--slug <slug>] [--stale-days N] [--dir <path>]
//     --slug <slug>   指定ゴール 1 件の全ステップ詳細を返す（再開時に使う）
//     --stale-days N  停滞判定の日数（既定 7）
//     --dir <path>    .belta のベースを上書き（既定 <home>/.belta）。テスト用
//
// 出力: JSON 1 つ（下記 buildResult の構造）。常に exit 0。

const path = require("path");
const os = require("os");

// session-start.js (G) と共通のパーサを再利用（判定基準を一元化）。
let goalUtil;
try {
  goalUtil = require(path.join(__dirname, "..", "hooks", "goal-util.js"));
} catch {
  goalUtil = { listGoals: () => [] };
}
const { listGoals } = goalUtil;

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let slug = null;
let staleDays = 7;
let dirOverride = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--slug") slug = argv[++i];
  else if (a === "--stale-days") staleDays = parseInt(argv[++i], 10);
  else if (a === "--dir") dirOverride = argv[++i];
}
if (!Number.isFinite(staleDays) || staleDays <= 0) staleDays = 7;
if (staleDays > 366) staleDays = 366; // 暴走防止の上限

// ---- パス解決 ----------------------------------------------------------------
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}
const beltaDir = dirOverride || path.join(homeDir(), ".belta");
const goalsDir = path.join(beltaDir, "goals");

// ---- 走査 --------------------------------------------------------------------
// 一覧では steps 全文を落として軽くする（詳細は --slug で取る）。
function summarize(g) {
  const { steps, ...rest } = g;
  return rest;
}

function buildResult() {
  const goals = listGoals(goalsDir, { staleDays });

  if (slug) {
    const found = goals.find((g) => g.slug === slug) || null;
    return {
      generated_at: new Date().toISOString(),
      goals_dir: goalsDir,
      slug,
      found: !!found,
      goal: found, // steps 全詳細込み
    };
  }

  const active = goals.filter((g) => g.status === "active").map(summarize);
  const done = goals.filter((g) => g.status === "done").map(summarize);
  const archivedCount = goals.filter((g) => g.status === "archived").length;
  return {
    generated_at: new Date().toISOString(),
    goals_dir: goalsDir,
    stale_days: staleDays,
    active,
    done,
    archived_count: archivedCount,
    stale_count: active.filter((g) => g.stale).length,
  };
}

// ---- 出力（fail-open）--------------------------------------------------------
function emptyResult() {
  if (slug) {
    return { generated_at: new Date().toISOString(), goals_dir: goalsDir, slug, found: false, goal: null };
  }
  return {
    generated_at: new Date().toISOString(),
    goals_dir: goalsDir,
    stale_days: staleDays,
    active: [],
    done: [],
    archived_count: 0,
    stale_count: 0,
  };
}

try {
  process.stdout.write(JSON.stringify(buildResult(), null, 2) + "\n");
} catch {
  try {
    process.stdout.write(JSON.stringify(emptyResult(), null, 2) + "\n");
  } catch {
    /* それでも失敗したら何も出さない */
  }
}
process.exit(0);
