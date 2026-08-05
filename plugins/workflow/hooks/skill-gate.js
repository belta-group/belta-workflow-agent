#!/usr/bin/env node
//
// BELTA workflow plugin — スキル許可ゲート（PreToolUse: Skill）
//
// 「許可されたスキルしか使えない」を仕組みで担保する。静的な allow 列挙では
// 自作スキル（skill-authoring が動的に生成）や導入スキル（skill-suggestion）を
// 壊してしまうため、allowset を **起動時に決定的に組み立てる**。
//
// allowset の構成:
//   (a) 同梱スキル      … <plugin>/skills/*/SKILL.md の frontmatter name
//   (b) 自作スキル      … ~/.belta/skills/AUTHORED.md の記録（deleted_at 付きは除外）
//   (c) 導入済みスキル  … ~/.belta/skills/SKILLS.md の installed 行（uninstalled は除外）
//   (d) 静的許可        … <plugin>/.claude/skill-policy.json の allowedSkills / allowedPrefixes
//
// allowset 外の起動は既定で **ask**（確認ダイアログ）。~/.belta/config.yaml の
// skill_gate_mode で ask | deny | off に切り替えられる。
//   ask  … 未許可でも利用者が許可すれば使える（既定。誤遮断で業務を止めない）
//   deny … 未許可を機械的にブロック（厳格運用）
//   off  … 判定せず監査ログのみ（導入初期の傾向収集用）
//
// スキル安全性チェック（scripts/skill-audit.js）の結果が
// ~/.belta/audit/skills/<name>.json にあれば、ask の理由文に要約を添える。
//
// 例外時は無出力 exit 0（fail-open。フックの失敗でセッションを止めない）。
// デバッグ: BELTA_SKILLGATE_DEBUG=1 で受信ペイロードを ~/.belta/audit/skill-gate-debug.log へ。

const fs = require("fs");
const path = require("path");
const os = require("os");
const { recordSecurityEvent } = require("./audit-log.js");

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, "..");
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

// config.yaml（フラット YAML）から 1 キー読む
function readConfigValue(key, fallback) {
  const text = readText(path.join(homeDir(), ".belta", "config.yaml"));
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith(key)) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    if (line.slice(0, idx).trim() !== key) continue;
    let val = line.slice(idx + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    return val || fallback;
  }
  return fallback;
}

// ---- allowset の構築 ---------------------------------------------------------
// (a) 同梱スキル: skills/*/SKILL.md の frontmatter name（無ければディレクトリ名）
function bundledSkillNames() {
  const names = new Set();
  const dir = path.join(pluginRoot(), "skills");
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return names;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    names.add(e.name);
    const text = readText(path.join(dir, e.name, "SKILL.md"));
    const m = /^\s*name:\s*(.+?)\s*$/m.exec(text.split(/^---\s*$/m)[1] || "");
    if (m) names.add(m[1].replace(/^["']|["']$/g, ""));
  }
  return names;
}

// (b) 自作スキル: AUTHORED.md。`- [name](...)` か `- name —` を拾い、deleted_at 付きは除外。
function authoredSkillNames() {
  const names = new Set();
  const text = readText(path.join(homeDir(), ".belta", "skills", "AUTHORED.md"));
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) continue;
    if (/deleted_at:\s*\d{4}-\d{2}-\d{2}/.test(line)) continue;
    const linked = /^-\s*\[([^\]]+)\]/.exec(line);
    const plain = /^-\s*([\w.:-]+)\s*[—-]/.exec(line);
    const name = (linked && linked[1]) || (plain && plain[1]);
    if (name) names.add(name.trim());
  }
  return names;
}

// (c) 導入済みスキル: SKILLS.md の `- name — ... [installed:...]`。uninstalled 付きは除外。
function installedSkillNames() {
  const names = new Set();
  const text = readText(path.join(homeDir(), ".belta", "skills", "SKILLS.md"));
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) continue;
    if (!/installed:\s*\d{4}-\d{2}-\d{2}/.test(line)) continue;
    if (/uninstalled:\s*\d{4}-\d{2}-\d{2}/.test(line)) continue;
    const m = /^-\s*\[?([\w.:-]+)\]?/.exec(line);
    if (m) names.add(m[1].trim());
  }
  return names;
}

// (d) 静的ポリシー
function policy() {
  const p = readJson(path.join(pluginRoot(), ".claude", "skill-policy.json")) || {};
  return {
    allowedSkills: Array.isArray(p.allowedSkills) ? p.allowedSkills : [],
    allowedPrefixes: Array.isArray(p.allowedPrefixes) ? p.allowedPrefixes : [],
  };
}

// ---- 監査結果（skill-audit.js の出力）----------------------------------------
function auditSummary(name) {
  const safe = String(name).replace(/[^\w.:-]/g, "_");
  const report = readJson(path.join(homeDir(), ".belta", "audit", "skills", `${safe}.json`));
  if (!report) return { audited: false, high: 0 };
  const findings = Array.isArray(report.findings) ? report.findings : [];
  return { audited: true, high: findings.filter((f) => f && f.severity === "high").length };
}

// ---- メイン ------------------------------------------------------------------
function emit(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }) + "\n"
  );
  process.exit(0);
}

try {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    raw = "";
  }
  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    payload = {};
  }

  const ti = payload.tool_input || {};
  const skillRaw = String(ti.skill || ti.skill_name || ti.name || "").trim();

  if (process.env.BELTA_SKILLGATE_DEBUG === "1") {
    try {
      const dir = path.join(homeDir(), ".belta", "audit");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, "skill-gate-debug.log"), raw.trim() + "\n", "utf8");
    } catch {
      /* デバッグ記録の失敗は無視 */
    }
  }

  // スキル名が取れない（フィールド名が想定と違う等）→ 素通し。
  // 判定できないものをブロックすると、フィールド名の変更で全スキルが止まる。
  if (!skillRaw) process.exit(0);

  const mode = String(readConfigValue("skill_gate_mode", "ask")).toLowerCase();

  const { allowedSkills, allowedPrefixes } = policy();
  const allowset = new Set([
    ...bundledSkillNames(),
    ...authoredSkillNames(),
    ...installedSkillNames(),
    ...allowedSkills,
  ]);

  // `plugin:skill` 形式にも対応（名前空間を外した名前でも照合する）
  const bare = skillRaw.includes(":") ? skillRaw.slice(skillRaw.lastIndexOf(":") + 1) : skillRaw;
  const prefixOk = allowedPrefixes.some((pre) => pre && skillRaw.startsWith(pre));
  const allowed = prefixOk || allowset.has(skillRaw) || allowset.has(bare);

  if (allowed) process.exit(0); // 許可済み → 無出力素通し（監査ログも汚さない）

  const audit = auditSummary(bare);
  recordSecurityEvent({
    decision: mode === "deny" ? "deny" : "ask",
    hook: "skill-gate",
    tool: "Skill",
    rule: "skill-allowlist",
    subject: skillRaw,
    labels: [audit.audited ? `audited(high:${audit.high})` : "unaudited", `mode:${mode}`],
    session: String(payload.session_id || ""),
  });

  if (mode === "off") process.exit(0); // 記録だけして素通し

  const auditNote = audit.audited
    ? audit.high > 0
      ? `\n⚠️ 安全性チェックで注意点が ${audit.high} 件見つかっています（\`~/.belta/audit/skills/${bare}.json\`）。`
      : `\n安全性チェックは実施済みで、重大な注意点はありませんでした。`
    : `\nこのスキルはまだ安全性チェックを受けていません。中身を確認するには次を実行してください:\n  node "\${CLAUDE_PLUGIN_ROOT}/scripts/skill-audit.js" --name ${bare}`;

  const reason =
    `[BELTA スキル許可リスト] \`${skillRaw}\` は、この環境で使うことが記録されていないスキルです。\n` +
    `（同梱スキル・導入記録のあるスキル・許可リスト掲載スキルのいずれにも該当しません）` +
    auditNote +
    `\n\n自分で導入したスキルなら許可して構いません。心当たりがなければ拒否してください。`;

  if (mode === "deny") {
    emit(
      "deny",
      reason.replace("[BELTA スキル許可リスト]", "[BELTA スキル許可リスト・厳格モード]") +
        `\n\n使う必要がある場合は、導入記録（\`~/.belta/skills/SKILLS.md\`）に登録するか、` +
        `\`skill_gate_mode\` を ask に戻してください。`
    );
  }
  emit("ask", reason);
} catch {
  process.exit(0); // fail-open
}
