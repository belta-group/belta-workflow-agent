#!/usr/bin/env node
//
// BELTA workflow plugin — スキルカタログ照合エンジン（skill-suggestion 用）
//
// キュレート済みカタログ（skills-catalog.json）を決定的に読取・フィルタし、
// 「いま提案しうるスキル候補」を JSON で stdout に出す。意味判断（どれを・どう提案するか）
// は skill-suggestion スキル（LLM）が行う。本スクリプトはネットワークアクセスを一切持たない
// （オフライン・決定的）。カタログに無い能力の探索は find-skills（LLM 側のフォールバック）。
//
// 設計方針（notes-scan.js / schedule-spec.js と同じ鉄則。cross-platform.md 準拠）:
//   - シェル非依存の Node.js のみ。パスは path API、ホームは環境変数から解決、改行は /\r?\n/。
//   - 外部依存なし・読み取り専用（SKILLS.md への書き込みはしない＝状態の正本は触らない）。
//   - 信頼判定（auto_installable）は source から **再計算** する。カタログの auto_installable 欄は
//     人間可読の冗長記載で、ここで source（belta-group/* | anthropic）から正規の値を算出する
//     （allowlist のルールが変わってもカタログ再生成ではなく下の isAutoInstallable 1 箇所を直す）。
//   - 状態（new/installed/rejected/cooldown）は ~/.belta/skills/SKILLS.md を **読んで** 各候補に
//     アノテートするだけ。却下3回→14営業日冷却の既存ロジックと衝突させない。
//   - fail-open: カタログが読めない・壊れていても落とさず catalog_available:false + 空配列を出して
//     exit 0（呼び出し側はこれを見て find-skills に倒す）。
//
// 使い方:
//   node catalog-scan.js [--category <c>] [--department <slug>] [--audience <a>]
//                        [--source <belta-group|anthropic|third-party>]
//                        [--auto-installable] [--available-only] [--dir <path>] [--json]
//     --category <c>        document|spreadsheet|slides|automation|authoring|discovery|dept-specific
//     --department <slug>   departments が空（部署非依存）または当該 slug を含む候補
//     --audience <a>        audience 配列に当該値（all|dev|dept:<slug> 等）を含む候補
//     --source <s>          belta-group | anthropic | third-party（接頭辞一致）または完全一致
//     --auto-installable    source から再計算した auto_installable が true のものだけ
//     --available-only      導入済み（installed）を除外（まだ提案余地があるものに絞る）
//     --dir <path>          .belta のベースを上書き（既定 <home>/.belta）。テスト用
//     --json                明示用（既定で JSON 出力）
//
// 出力: JSON 1 つ（buildResult の構造）。常に exit 0。
// 既定の挙動: 冷却中（cooldown が今日以降）の候補は candidates から除外する（提案できないため）。
//             ただし counts.in_cooldown には数える。

const fs = require("fs");
const path = require("path");
const os = require("os");

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let category = null;
let department = null;
let audience = null;
let source = null;
let autoInstallableOnly = false;
let availableOnly = false;
let dirOverride = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--category") category = argv[++i];
  else if (a === "--department") department = argv[++i];
  else if (a === "--audience") audience = argv[++i];
  else if (a === "--source") source = argv[++i];
  else if (a === "--auto-installable") autoInstallableOnly = true;
  else if (a === "--available-only") availableOnly = true;
  else if (a === "--dir") dirOverride = argv[++i];
  // --json は既定挙動なので明示用（無視してよい）
}

// ---- パス解決（既存スクリプトと同じ流儀）------------------------------------
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}
function pluginRoot() {
  // フックから ${CLAUDE_PLUGIN_ROOT} 経由で呼ばれる前提。無ければ scripts/ の親（= plugins/workflow）。
  return process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, "..");
}
const catalogPath = path.join(pluginRoot(), "skills", "skill-suggestion", "references", "skills-catalog.json");
const beltaDir = dirOverride || path.join(homeDir(), ".belta");
const skillsMdPath = path.join(beltaDir, "skills", "SKILLS.md");

// ---- 日付ユーティリティ ------------------------------------------------------
function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---- 信頼判定（source → auto_installable の正規実装）------------------------
// allowlist の権威ルール（belta-group/* + Anthropic 公式のみ自動導入可）を 1 箇所で表す。
function isAutoInstallable(src) {
  if (typeof src !== "string") return false;
  const s = src.trim().toLowerCase();
  return s === "anthropic" || s.startsWith("belta-group/");
}

// ---- SKILLS.md パース（状態のアノテート用・読み取り専用）---------------------
// 追記 1 行の形式（skill-suggestion/SKILL.md）:
//   - <id> — <用途> [suggested:YYYY-MM-DD / installed:YYYY-MM-DD / source:<provider>]
//   却下: [... / rejected:YYYY-MM-DD (n) / cooldown_until:YYYY-MM-DD]
//   削除: [... / uninstalled:YYYY-MM-DD]
// 同一 id が複数行あれば最後の行（最新状態）を採用する。
function parseSkillsMd() {
  const map = new Map(); // id -> annotation 文字列（最新）
  let text = "";
  try {
    text = fs.readFileSync(skillsMdPath, "utf8");
  } catch {
    return map; // 無ければ全候補 new 扱い
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // "- <id> — ... [..]" または "- <id> - ... [..]"（em-dash / hyphen 両対応）
    const m = /^-\s+(\S+)\s+[—–-]/.exec(line);
    if (!m) continue;
    const id = m[1];
    const bm = /\[([^\]]*)\]/.exec(line);
    if (bm) map.set(id, bm[1]); // 最後の行で上書き＝最新
  }
  return map;
}

function statusFromAnnotation(ann, today) {
  const a = String(ann || "");
  const hasInstalled = /\binstalled:/.test(a);
  const hasUninstalled = /\buninstalled:/.test(a);
  const hasRejected = /\brejected:/.test(a);
  const cm = /cooldown_until:\s*(\d{4}-\d{2}-\d{2})/.exec(a);
  const cooldownUntil = cm ? cm[1] : null;
  const cooldownActive = cooldownUntil && cooldownUntil >= today; // ISO 日付は辞書順比較で OK

  if (hasInstalled && !hasUninstalled) return { status: "installed", cooldown_until: cooldownUntil };
  if (cooldownActive) return { status: "cooldown", cooldown_until: cooldownUntil };
  if (hasRejected) return { status: "rejected", cooldown_until: cooldownUntil }; // 冷却切れ＝再提案可
  return { status: "new", cooldown_until: cooldownUntil };
}

// ---- カタログ読込（fail-open）------------------------------------------------
function readCatalog() {
  try {
    const raw = fs.readFileSync(catalogPath, "utf8");
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.skills)) {
      return { ok: true, version: obj.$schema_version || null, skills: obj.skills };
    }
    return { ok: false, version: null, skills: [] };
  } catch {
    return { ok: false, version: null, skills: [] };
  }
}

// ---- フィルタ ----------------------------------------------------------------
function matchesBaseFilters(skill) {
  if (category && skill.category !== category) return false;

  if (department) {
    const deps = Array.isArray(skill.departments) ? skill.departments : [];
    // 空配列 = 部署非依存（全部署で推奨）。非空なら当該 slug を含むもののみ。
    if (deps.length > 0 && !deps.includes(department)) return false;
  }

  if (audience) {
    const aud = Array.isArray(skill.audience) ? skill.audience : [];
    if (!aud.includes(audience)) return false;
  }

  if (source) {
    const src = typeof skill.source === "string" ? skill.source.toLowerCase() : "";
    const want = source.toLowerCase();
    if (want === "belta-group") {
      if (!src.startsWith("belta-group/")) return false;
    } else if (want === "third-party") {
      if (!src.startsWith("third-party")) return false;
    } else if (want === "anthropic") {
      if (src !== "anthropic") return false;
    } else if (src !== want) {
      return false;
    }
  }
  return true;
}

// ---- 構築 --------------------------------------------------------------------
function buildResult() {
  const cat = readCatalog();
  const today = todayStamp();
  const filters = { category, department, audience, source, auto_installable: autoInstallableOnly, available_only: availableOnly };

  if (!cat.ok) {
    return {
      generated_at: new Date().toISOString(),
      catalog_path: catalogPath,
      catalog_available: false, // 呼び出し側はこれを見て find-skills に倒す
      catalog_version: null,
      filters,
      candidates: [],
      counts: { total: 0, auto_installable: 0, in_cooldown: 0, installed: 0 },
    };
  }

  const skillsMd = parseSkillsMd();

  // 1) 属性フィルタ → 2) status アノテート（counts はこの段階で算出）
  const annotated = [];
  for (const s of cat.skills) {
    if (!matchesBaseFilters(s)) continue;
    const auto = isAutoInstallable(s.source);
    if (autoInstallableOnly && !auto) continue;
    const st = statusFromAnnotation(skillsMd.get(s.id), today);
    annotated.push({
      id: s.id,
      name: s.name || s.id,
      category: s.category || null,
      official: !!s.official,
      source: s.source || null,
      auto_installable: auto, // ← source から再計算した正規値
      install_hint: s.install_hint || null,
      install_verified: !!s.install_verified,
      note: s.note || null,
      audience: Array.isArray(s.audience) ? s.audience : [],
      required_permissions: Array.isArray(s.required_permissions) ? s.required_permissions : [],
      departments: Array.isArray(s.departments) ? s.departments : [],
      status: st.status,
      cooldown_until: st.cooldown_until,
    });
  }

  const counts = {
    total: annotated.length,
    auto_installable: annotated.filter((c) => c.auto_installable).length,
    in_cooldown: annotated.filter((c) => c.status === "cooldown").length,
    installed: annotated.filter((c) => c.status === "installed").length,
  };

  // 3) 候補の絞り込み: 冷却中は既定で除外（提案できない）。--available-only なら導入済みも除外。
  let candidates = annotated.filter((c) => c.status !== "cooldown");
  if (availableOnly) candidates = candidates.filter((c) => c.status !== "installed");

  // 提案順: 部署一致 → auto_installable → new を優先（決定的タイブレークに id）。
  const statusRank = { new: 0, rejected: 1, installed: 2, cooldown: 3 };
  candidates.sort((a, b) => {
    const da = department && a.departments.includes(department) ? 0 : 1;
    const db = department && b.departments.includes(department) ? 0 : 1;
    if (da !== db) return da - db;
    if (a.auto_installable !== b.auto_installable) return a.auto_installable ? -1 : 1;
    const ra = statusRank[a.status] ?? 9;
    const rb = statusRank[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });

  return {
    generated_at: new Date().toISOString(),
    catalog_path: catalogPath,
    catalog_available: true,
    catalog_version: cat.version,
    skills_md_found: skillsMd.size > 0,
    filters,
    candidates,
    counts,
  };
}

// ---- 出力（fail-open）--------------------------------------------------------
try {
  process.stdout.write(JSON.stringify(buildResult(), null, 2) + "\n");
} catch {
  try {
    process.stdout.write(
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          catalog_path: catalogPath,
          catalog_available: false,
          filters: { category, department, audience, source, auto_installable: autoInstallableOnly, available_only: availableOnly },
          candidates: [],
          counts: { total: 0, auto_installable: 0, in_cooldown: 0, installed: 0 },
        },
        null,
        2
      ) + "\n"
    );
  } catch {
    /* それでも失敗したら何も出さない */
  }
}
process.exit(0);
