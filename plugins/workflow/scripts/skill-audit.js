#!/usr/bin/env node
//
// BELTA workflow plugin — スキル安全性チェック（決定的な静的スキャナ）
//
// スキルフォルダ（SKILL.md + references/ + scripts/ + assets/）を走査し、
// 「入れる前に人が目で見るべき点」を機械的に洗い出す。
// skill-allowlist.md の目視確認チェックリストを、見落としの無い決定的な検査に落とす。
//
// 🔴 このスクリプトは「検出」までで、採否は判定しない。
//    findings を人（と LLM）が読んで導入するかを決める。静的スキャンを通ったことは
//    安全の保証ではない（動的にコードを取得する等は原理的に検出できない）。
//
// 使い方:
//   node scripts/skill-audit.js --dir <スキルフォルダ>      # 明示パス
//   node scripts/skill-audit.js --name <スキル名>            # <agent_home>/.claude/skills/<name>
//   node scripts/skill-audit.js --bundled                    # 同梱スキル全件（誤検知ベースライン確認）
//   [--json]        … JSON のみ出力（既定は人間可読 + JSON 保存）
//   [--no-save]     … ~/.belta/audit/skills/<name>.json に保存しない
//
// 出力: { ok, skill, dir, scanned_files, findings: [{severity, rule, file, line, excerpt}] }
//   severity: high（要確認）/ medium（用途と釣り合うか確認）/ info（把握しておく）
// 例外時も exit 0（fail-open。監査の失敗で導入フローを止めない。ok:false で伝える）。

const fs = require("fs");
const path = require("path");
const os = require("os");

// ---- 引数 --------------------------------------------------------------------
const argv = process.argv.slice(2);
let dirArg = null;
let nameArg = null;
let jsonOnly = false;
let noSave = false;
let bundled = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--dir") dirArg = argv[++i];
  else if (argv[i] === "--name") nameArg = argv[++i];
  else if (argv[i] === "--json") jsonOnly = true;
  else if (argv[i] === "--no-save") noSave = true;
  else if (argv[i] === "--bundled") bundled = true;
}

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, "..");
}

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// config.yaml の agent_home（フラット YAML の 1 行パース）
function agentHome() {
  const text = readText(path.join(homeDir(), ".belta", "config.yaml")) || "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    if (line.slice(0, idx).trim() !== "agent_home") continue;
    let val = line.slice(idx + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    return val;
  }
  return "";
}

// ---- 検査ルール --------------------------------------------------------------
// 行単位の正規表現マッチ。テキスト系ファイル（.md / .js / .json / .sh / .py / .txt）を対象。
// codeOnly: true のルールは Markdown では「フェンス付きコードブロックの中だけ」を見る。
// 散文で `rm -rf` や `.claude/settings.json` に言及しているだけの行（＝説明文）を
// 危険と誤検知しないため。実行される可能性があるのはコードブロックの中身と、
// .js / .sh 等の実行ファイル本体だけ。
const RULES = [
  {
    rule: "destructive-command",
    severity: "high",
    codeOnly: true,
    why: "取り消しにくい破壊操作",
    re: /\brm\s+-[rf]{1,2}\b|\bsudo\b|\bgit\s+push\s+(--force|-f)\b|\bgit\s+reset\s+--hard\b|\bchmod\s+-R\b|\bmkfs\b|\bdd\s+if=/,
  },
  {
    rule: "os-specific-command",
    codeOnly: true,
    severity: "medium",
    why: "OS 依存コマンド（Windows で動かない恐れ。cross-platform 規約）",
    re: /\bmkdir\s+-p\b|\bln\s+-s\b|\bcp\s+-[a-zA-Z]*\s|\btouch\s+[^\s]|\bchown\b/,
  },
  {
    rule: "obfuscated-exec",
    codeOnly: true,
    severity: "high",
    why: "難読化したコードの実行",
    re: /base64\s+(-d|--decode)[\s\S]*\|\s*(sh|bash|zsh|node|python)|Buffer\.from\([^)]*base64[^)]*\)[\s\S]{0,40}(eval|exec|Function)|\beval\s*\(|new\s+Function\s*\(/,
  },
  {
    rule: "settings-tampering",
    codeOnly: true,
    severity: "high",
    why: "エージェント自身の権限・フック設定の書き換え",
    // 設定ファイルへの「言及」ではなく「書き込み」を伴う行だけを拾う
    // （権限の上限を参照する正当な記述＝読み取りは誤検知させない）。
    test: (line) =>
      /(\.claude[/\\]settings(\.local)?\.json|managed-settings\.json|hooks[/\\]hooks\.json|enabledPlugins)/.test(line) &&
      /(writeFileSync|appendFileSync|renameSync|rmSync|unlinkSync|sed\s+-i|\btee\b|>>?\s*["']?\S*settings|\bWrite\b|\bEdit\b|\bcp\b|\bmv\b)/.test(
        line
      ),
  },
  {
    rule: "external-post",
    codeOnly: true,
    severity: "medium",
    why: "外部への送信（用途と釣り合うか確認）",
    re: /\b(curl|wget)\b[\s\S]*(-X\s*(POST|PUT|PATCH)|--data|-d\s)|fetch\([^)]*method\s*:\s*["'](POST|PUT|PATCH)/i,
  },
  {
    rule: "network-fetch",
    codeOnly: true,
    severity: "info",
    why: "外部ネットワークへのアクセス",
    re: /https?:\/\/(?!(localhost|127\.0\.0\.1))[\w.-]+/,
  },
  {
    rule: "shell-script",
    severity: "medium",
    why: "シェルスクリプト同梱（Node.js 単一実装が原則）",
    fileTest: (rel) => /\.(sh|bash|zsh|ps1|bat|cmd)$/i.test(rel),
  },
];

// ファイル単位のルール（複数行にまたがるパターン）。
// 「認証情報を読む行」と「外部へ送る行」が離れているのが実際の流出コードの形なので、
// 行単位の検査では捕まらない。実行されうる領域だけを連結してから判定する。
const FILE_RULES = [
  {
    rule: "credential-exfil",
    severity: "high",
    why: "認証情報を読んで外部へ送る組み合わせ（同一ファイル内）",
    credential: /(\.env\b|\.ssh\b|id_rsa|credentials|process\.env|ANTHROPIC_API_KEY|GITHUB_TOKEN|API_KEY|password|secret)/i,
    sink: /(curl|wget|fetch\s*\(|axios|https?:\/\/|nc\s|--data|method\s*:\s*["'](POST|PUT))/i,
  },
];

const TEXT_EXT = /\.(md|markdown|js|mjs|cjs|json|ya?ml|sh|bash|zsh|ps1|bat|cmd|py|rb|txt)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "dist", "build"]);
const MAX_FILE_BYTES = 512 * 1024;

function walk(dir, base, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, base, out);
    } else if (e.isFile()) {
      out.push({ full, rel });
    }
  }
  return out;
}

function excerpt(line) {
  const one = line.replace(/\s+/g, " ").trim();
  return one.length > 160 ? one.slice(0, 157) + "…" : one;
}

// frontmatter の description を取り出す。YAML のブロックスカラー（`description: >` /
// `description: |` に続くインデント行）にも対応する（同梱スキルの大半がこの形）。
function extractDescription(fm) {
  const lines = fm.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)description:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const inline = m[2].trim();
    if (inline && !/^[>|][-+]?$/.test(inline)) return inline.replace(/^["']|["']$/g, "");
    // ブロックスカラー: 続く「より深いインデント」の行を連結する
    const buf = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) continue;
      const curIndent = l.length - l.trimStart().length;
      if (curIndent <= indent) break;
      buf.push(l.trim());
    }
    return buf.join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}

// frontmatter 妥当性（発火に必要な name / description が揃っているか）
function checkFrontmatter(skillMd, findings) {
  if (skillMd == null) {
    findings.push({
      severity: "high",
      rule: "missing-skill-md",
      file: "SKILL.md",
      line: 0,
      excerpt: "SKILL.md が見つかりません（スキルとして読み込まれません）",
      why: "スキルの実体が無い",
    });
    return;
  }
  const parts = skillMd.split(/^---\s*$/m);
  const fm = parts.length >= 3 ? parts[1] : "";
  if (!fm.trim()) {
    findings.push({
      severity: "high",
      rule: "missing-frontmatter",
      file: "SKILL.md",
      line: 1,
      excerpt: "frontmatter（--- で囲む name / description）が無い",
      why: "発火条件が定義されていない",
    });
    return;
  }
  if (!/^\s*name:\s*\S/m.test(fm)) {
    findings.push({
      severity: "high",
      rule: "missing-name",
      file: "SKILL.md",
      line: 2,
      excerpt: "frontmatter に name がない",
      why: "スキル名が解決できない",
    });
  }
  const descText = extractDescription(fm);
  if (!descText) {
    findings.push({
      severity: "high",
      rule: "missing-description",
      file: "SKILL.md",
      line: 2,
      excerpt: "frontmatter に description がない",
      why: "発火判定ができず、常時読み込みか無発火になる",
    });
  } else if (descText.length < 30) {
    findings.push({
      severity: "medium",
      rule: "vague-description",
      file: "SKILL.md",
      line: 2,
      excerpt: excerpt(descText),
      why: "description が短く発火条件が曖昧（無関係な場面で誤発火しうる）",
    });
  }
}

function auditSkill(dir) {
  const name = path.basename(dir);
  const findings = [];
  const skillMd = readText(path.join(dir, "SKILL.md"));
  checkFrontmatter(skillMd, findings);

  const files = walk(dir, dir, []);
  let scanned = 0;

  for (const f of files) {
    for (const r of RULES) {
      if (r.fileTest && r.fileTest(f.rel)) {
        findings.push({
          severity: r.severity,
          rule: r.rule,
          file: f.rel,
          line: 0,
          excerpt: f.rel,
          why: r.why,
        });
      }
    }

    if (!TEXT_EXT.test(f.rel)) continue;
    let stat;
    try {
      stat = fs.statSync(f.full);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;
    const text = readText(f.full);
    if (text == null) continue;
    scanned++;

    // Markdown は「フェンス付きコードブロックの中だけ」を実行されうる領域として扱う。
    const isMarkdown = /\.(md|markdown|txt)$/i.test(f.rel);
    let inFence = false;
    const execLines = []; // 実行されうる行（ファイル単位ルール用。{ n, text }）

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isMarkdown && /^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (!line.trim()) continue;
      const executable = !isMarkdown || inFence;
      if (executable) execLines.push({ n: i + 1, text: line });
      for (const r of RULES) {
        if (r.fileTest) continue;
        if (r.codeOnly && !executable) continue;
        const hit = r.test ? r.test(line) : r.re.test(line);
        if (hit) {
          findings.push({
            severity: r.severity,
            rule: r.rule,
            file: f.rel,
            line: i + 1,
            excerpt: excerpt(line),
            why: r.why,
          });
        }
      }
    }

    // ファイル単位ルール（複数行にまたがる組み合わせ）
    for (const r of FILE_RULES) {
      const credLine = execLines.find((l) => r.credential.test(l.text));
      if (!credLine) continue;
      if (!execLines.some((l) => r.sink.test(l.text))) continue;
      findings.push({
        severity: r.severity,
        rule: r.rule,
        file: f.rel,
        line: credLine.n,
        excerpt: excerpt(credLine.text),
        why: r.why,
      });
    }
  }

  return { ok: true, skill: name, dir, scanned_files: scanned, findings };
}

// ---- 保存 --------------------------------------------------------------------
function saveReport(report) {
  try {
    const dir = path.join(homeDir(), ".belta", "audit", "skills");
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(report.skill).replace(/[^\w.:-]/g, "_");
    const p = path.join(dir, `${safe}.json`);
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ ...report, audited_at: new Date().toISOString() }, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, p);
    return p;
  } catch {
    return null;
  }
}

// ---- 人間可読の出力 ----------------------------------------------------------
const SEV_ORDER = { high: 0, medium: 1, info: 2 };
function printReport(report, savedTo) {
  const counts = { high: 0, medium: 0, info: 0 };
  for (const f of report.findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  console.log(`[skill-audit] ${report.skill}（${report.dir}）`);
  console.log(`  走査: ${report.scanned_files} ファイル / 検出: high ${counts.high} / medium ${counts.medium} / info ${counts.info}`);
  const sorted = report.findings.slice().sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  for (const f of sorted.slice(0, 40)) {
    console.log(`  [${f.severity}] ${f.rule} — ${f.why}`);
    console.log(`        ${f.file}:${f.line}  ${f.excerpt}`);
  }
  if (sorted.length > 40) console.log(`  … 他 ${sorted.length - 40} 件`);
  if (counts.high === 0) {
    console.log("  → high は 0 件。ただし静的スキャンを通ったことは安全の保証ではない（動的取得コード等は検出できない）。");
  } else {
    console.log("  → high がある。該当箇所を目視し、用途に照らして妥当でなければ導入を見送る。");
  }
  if (savedTo) console.log(`  保存: ${savedTo}`);
}

// ---- メイン ------------------------------------------------------------------
try {
  const targets = [];

  if (bundled) {
    const skillsDir = path.join(pluginRoot(), "skills");
    for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (e.isDirectory()) targets.push(path.join(skillsDir, e.name));
    }
  } else if (dirArg) {
    targets.push(path.resolve(dirArg));
  } else if (nameArg) {
    const home = agentHome();
    const base = home ? path.join(home, ".claude", "skills") : path.join(process.cwd(), ".claude", "skills");
    targets.push(path.join(base, nameArg));
  } else {
    console.error("[skill-audit] --dir <path> / --name <skill> / --bundled のいずれかを指定してください");
    process.exit(0);
  }

  const reports = [];
  for (const t of targets) {
    if (!fs.existsSync(t)) {
      const r = { ok: false, skill: path.basename(t), dir: t, scanned_files: 0, findings: [], error: "not_found" };
      reports.push(r);
      continue;
    }
    const r = auditSkill(t);
    const savedTo = noSave ? null : saveReport(r);
    reports.push(r);
    if (!jsonOnly) printReport(r, savedTo);
  }

  if (jsonOnly) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  }
  process.exit(0);
} catch (e) {
  // fail-open: 監査の失敗で導入フローを止めない
  console.log(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
  process.exit(0);
}
