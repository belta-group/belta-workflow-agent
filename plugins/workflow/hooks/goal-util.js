//
// BELTA workflow plugin — ゴールファイル共有パーサ（goal-scan.js / session-start.js 共用）
//
// `~/.belta/goals/<slug>.md`（goal スキルの真実のソース）を決定的に解析する。
// 書式の正本は skills/goal/references/goal-format.md。要点:
//   - frontmatter は単純な `key: value` 行（YAML ライブラリ非依存で読める範囲に限定）
//   - 進捗は `## ステップ` 見出しから次の `##` までのチェックボックス行だけを数える
//     （メモ欄などに書かれたチェックボックスを誤集計しない）
//   - チェックボックスは 3 状態のみ: `- [ ]` pending / `- [x]` done / `- [!]` blocked
//   - 完了日・ブロック理由は行末 HTML コメント `<!-- done:YYYY-MM-DD -->` / `<!-- blocked:理由 -->`
//
// 設計方針（repeat-util.js / tokens-util.js と同じ鉄則）:
//   - シェル非依存の Node.js のみ。改行は /\r?\n/ で両対応（cross-platform.md §6）。
//   - fail-open: 壊れた入力は null / 空配列で返し、決して throw を外へ漏らさない。
//   - 索引 GOALS.md は表示専用なので走査対象から除外する（真実のソースは個別ファイル）。

const fs = require("fs");
const path = require("path");

const STEP_RE = /^-\s\[( |x|!)\]\s+(.*)$/;
const DONE_COMMENT_RE = /<!--\s*done:([0-9]{4}-[0-9]{2}-[0-9]{2})\s*-->/;
const BLOCKED_COMMENT_RE = /<!--\s*blocked:([^>]*?)\s*-->/;

// ゴールファイル本文を解析する。壊れた入力（frontmatter 無し等）は null。
function parseGoalFile(text) {
  try {
    if (typeof text !== "string" || !text.trim()) return null;
    const lines = text.split(/\r?\n/);

    // ---- frontmatter（先頭の --- ... --- 間の key: value 行） ----
    if (lines[0].trim() !== "---") return null;
    const meta = {};
    let i = 1;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "---") {
        i++;
        break;
      }
      const m = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue; // 知らない行は無視（コメント等）
      // 行内コメント（# 以降）を落とす。値そのものに # を使う想定は無い。
      meta[m[1]] = m[2].replace(/\s+#.*$/, "").trim();
    }
    if (i >= lines.length) return null; // 閉じ --- が無い

    // ---- `## ステップ` 配下のチェックボックスだけを拾う ----
    const steps = [];
    let inSteps = false;
    for (; i < lines.length; i++) {
      const line = lines[i];
      const heading = /^##\s+(.+?)\s*$/.exec(line);
      if (heading) {
        inSteps = heading[1] === "ステップ";
        continue;
      }
      if (!inSteps) continue;
      const m = STEP_RE.exec(line.trim());
      if (!m) continue;
      const state = m[1] === "x" ? "done" : m[1] === "!" ? "blocked" : "pending";
      let body = m[2];
      let done_at = null;
      let blocked_reason = null;
      const dm = DONE_COMMENT_RE.exec(body);
      if (dm) done_at = dm[1];
      const bm = BLOCKED_COMMENT_RE.exec(body);
      if (bm) blocked_reason = bm[1].trim() || null;
      body = body.replace(/<!--[^>]*?-->/g, "").trim();
      steps.push({ text: body, state, done_at, blocked_reason });
    }

    const status = ["active", "done", "archived"].includes(meta.status) ? meta.status : "active";
    return {
      goal: meta.goal || "",
      slug: meta.slug || "",
      status,
      created_at: meta.created_at || null,
      updated_at: meta.updated_at || null,
      target_date: meta.target_date || null,
      steps,
    };
  } catch {
    return null;
  }
}

// goals ディレクトリを走査し、ゴールごとの進捗サマリを返す。ディレクトリ無しは []。
// stale = active かつ updated_at（無効なら mtime フォールバック）が staleDays より古い。
function listGoals(goalsDir, opts) {
  const staleDays = opts && Number.isFinite(opts.staleDays) && opts.staleDays > 0 ? opts.staleDays : 7;
  let names = [];
  try {
    names = fs.readdirSync(goalsDir);
  } catch {
    return [];
  }
  const out = [];
  const staleCutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  for (const name of names.sort()) {
    if (!/\.md$/i.test(name) || name === "GOALS.md") continue;
    const p = path.join(goalsDir, name);
    let text = "";
    try {
      text = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    const g = parseGoalFile(text);
    if (!g) continue;
    if (!g.slug) g.slug = name.replace(/\.md$/i, "");

    const counts = { total: g.steps.length, done: 0, blocked: 0, pending: 0 };
    for (const s of g.steps) counts[s.state]++;
    const next = g.steps.find((s) => s.state === "pending");
    const blockedSteps = g.steps
      .filter((s) => s.state === "blocked")
      .map((s) => ({ text: s.text, reason: s.blocked_reason }));

    // 最終更新の判定: frontmatter updated_at が日付として読めればそれ、無効なら mtime。
    let updatedMs = Date.parse(`${g.updated_at}T00:00:00Z`);
    if (!Number.isFinite(updatedMs)) {
      try {
        updatedMs = fs.statSync(p).mtimeMs;
      } catch {
        updatedMs = Date.now(); // 取れなければ stale 扱いにしない（安全側）
      }
    }
    const stale = g.status === "active" && updatedMs < staleCutoff;

    out.push({
      file: name,
      slug: g.slug,
      goal: g.goal,
      status: g.status,
      created_at: g.created_at,
      updated_at: g.updated_at,
      target_date: g.target_date,
      counts,
      next_step: next ? next.text : null,
      blocked_steps: blockedSteps,
      stale,
      steps: g.steps,
    });
  }
  return out;
}

module.exports = { parseGoalFile, listGoals };
