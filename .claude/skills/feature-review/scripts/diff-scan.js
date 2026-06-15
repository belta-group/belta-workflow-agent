#!/usr/bin/env node
//
// BELTA workflow — 差分走査エンジン（feature-review スキル用 / 開発者ツール）
//
// このリポジトリ自体の git 差分（既定で main 比較）を決定的に走査し、
//   (1) 変更ファイルの種別分類
//   (2) 5観点レビューの「一次証拠」になる機械シグナル
//   (3) 変更/追加された .js の node --check 結果
//   (4) 新規追加された機能（コマンド/スキル）の frontmatter
// を JSON で stdout に出す。意味判断・最終的なレビュー文面は LLM スキル
// （.claude/skills/feature-review/SKILL.md）が担う。このスクリプトは判定しない。
//
// 配布物ではなく開発ツール。リポジトリ規約（cross-platform.md）に敬意を払い、
//   - シェル非依存の Node.js のみ（git/gh は execFileSync で読み取り専用に呼ぶ）
//   - パスは path API、改行は /\r?\n/、ホームは環境変数から
//   - fail-open: git が無い・壊れていても落とさず、空に近い結果 JSON を出して exit 0
// で実装する。
//
// 使い方:
//   node diff-scan.js [--base <branch>] [--current] [--staged] [--pr <n>] [--root <path>]
//     --base <branch>  比較先ブランチ（既定 main）。merge-base 以降＋未コミットを対象
//     --current        直前コミット以降＋未コミット（base=HEAD~1 相当）
//     --staged         未コミット変更のみ（staged + unstaged、base 比較なし）
//     --pr <n>         GitHub PR #n の差分（gh pr diff <n>）
//     --root <path>    リポジトリルート上書き（既定 cwd）。テスト用
//
// 出力: JSON 1 つ。常に exit 0。

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let base = "main";
let mode = "base"; // base | current | staged | pr
let prNum = null;
let rootOverride = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--base") base = argv[++i] || "main";
  else if (a === "--current") mode = "current";
  else if (a === "--staged") mode = "staged";
  else if (a === "--pr") {
    mode = "pr";
    prNum = argv[++i] || null;
  } else if (a === "--root") rootOverride = argv[++i] || null;
}

const ROOT = rootOverride || process.cwd();

// ---- git/gh 実行（読み取り専用・fail-safe）----------------------------------
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}
const git = (args) => run("git", args);
const gh = (args) => run("gh", args);

// ---- 差分の取得（patch ＋ name-status）---------------------------------------
// 返り値: { patch: string, nameStatus: string, baseRef: string } | null
function getDiff() {
  if (mode === "pr") {
    if (!prNum) return null;
    const patch = gh(["pr", "diff", String(prNum), "--patch"]);
    const names = gh(["pr", "diff", String(prNum), "--name-only"]);
    if (patch == null) return null;
    // gh の --name-only は status を持たないので M 扱いで合成する。
    const nameStatus = (names || "")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((p) => `M\t${p}`)
      .join("\n");
    return { patch, nameStatus, baseRef: `PR #${prNum}` };
  }

  if (mode === "staged") {
    // HEAD と作業ツリー（staged + unstaged）を比較。
    const patch = git(["diff", "HEAD"]);
    const nameStatus = git(["diff", "--name-status", "HEAD"]);
    if (patch == null) return null;
    return { patch, nameStatus: nameStatus || "", baseRef: "HEAD (working tree)" };
  }

  if (mode === "current") {
    const patch = git(["diff", "HEAD~1"]);
    const nameStatus = git(["diff", "--name-status", "HEAD~1"]);
    if (patch == null) return null;
    return { patch, nameStatus: nameStatus || "", baseRef: "HEAD~1" };
  }

  // base モード: 分岐点（merge-base）以降のコミット＋未コミットを 1 発で取る。
  // `git diff <merge-base>` は作業ツリーまでを比較するので staged/unstaged も含む。
  const mb = (git(["merge-base", base, "HEAD"]) || "").trim();
  const ref = mb || base;
  const patch = git(["diff", ref]);
  const nameStatus = git(["diff", "--name-status", ref]);
  if (patch == null) return null;
  return { patch, nameStatus: nameStatus || "", baseRef: `${base} (merge-base ${mb ? mb.slice(0, 8) : "?"})` };
}

// ---- ファイル種別分類 --------------------------------------------------------
function classifyKind(p) {
  const f = p.replace(/\\/g, "/");
  if (/(^|\/)plugins\/workflow\/hooks\/.+\.js$/.test(f)) return "hook";
  if (/(^|\/)hooks\.json$/.test(f)) return "config";
  if (/(^|\/)scripts\/.+\.js$/.test(f)) return "script"; // スキル同梱の .js も script 扱い（fail-open 対象に）
  if (/(^|\/)skills\/[^/]+\/SKILL\.md$/.test(f)) return "skill";
  if (/(^|\/)skills\/.+/.test(f)) return "skill";
  if (/(^|\/)commands\/[^/]+\.md$/.test(f)) return "command";
  if (/(^|\/)docs\/.+/.test(f)) return "docs";
  if (/(^|\/)\.claude\/rules\/.+/.test(f)) return "rules";
  if (/(settings\.json|settings\.local\.json|plugin\.json|marketplace\.json|\.gitleaks\.toml)$/.test(f))
    return "config";
  return "other";
}

const isJs = (p) => /\.js$/.test(p);
const basename = (p) => p.replace(/\\/g, "/").split("/").pop();

// 内容まで読んで「全行追加」として扱う untracked のテキスト拡張子。
const TEXT_EXT = /\.(js|mjs|cjs|ts|md|json|toml|ya?ml|css|html|sh)$/i;

// コミット前のセルフレビュー用途のため、まだ git に追跡されていない新規ファイルも
// 「新規追加（A）」として取り込む（git diff は untracked を出さないため）。
// pr モードはリモート差分が対象なので作業ツリーの untracked は無視する。
function getUntracked() {
  if (mode === "pr") return [];
  const out = git(["ls-files", "--others", "--exclude-standard"]);
  if (!out) return [];
  return out.split(/\r?\n/).filter(Boolean).map((p) => p.replace(/\\/g, "/"));
}

// ---- patch のパース ----------------------------------------------------------
// ファイルごとに { added: [{line, text}], removed: [{text}] } を新ファイル行番号付きで集める。
function parsePatch(patch) {
  const byFile = new Map(); // path -> { added, removed }
  let cur = null; // current file path (new side)
  let newLine = 0;

  const ensure = (p) => {
    if (!byFile.has(p)) byFile.set(p, { added: [], removed: [] });
    return byFile.get(p);
  };

  for (const raw of patch.split(/\r?\n/)) {
    if (raw.startsWith("diff --git")) {
      cur = null;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const m = raw.slice(4).trim();
      cur = m === "/dev/null" ? null : m.replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    if (raw.startsWith("@@")) {
      // @@ -a,b +c,d @@
      const m = raw.match(/\+(\d+)/);
      newLine = m ? parseInt(m[1], 10) : 0;
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw.startsWith("+")) {
      ensure(cur).added.push({ line: newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith("-")) {
      ensure(cur).removed.push({ text: raw.slice(1) });
      // 削除行は新ファイル行番号を進めない
    } else {
      newLine++; // context
    }
  }
  return byFile;
}

// ---- name-status のパース ----------------------------------------------------
// 返り値: Map<path, status>（A/M/D/R…）。R100 は R に丸め、新パスを採用。
function parseNameStatus(text) {
  const map = new Map();
  for (const raw of (text || "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = raw.split(/\t/);
    const st = cols[0].charAt(0); // A/M/D/R/C
    const p = st === "R" || st === "C" ? cols[2] : cols[1];
    if (p) map.set(p.replace(/\\/g, "/"), st);
  }
  return map;
}

// ---- シグナル検出 ------------------------------------------------------------
// クロスプラットフォーム違反は .js の追加行のみ対象（md 内のコマンド例での誤検知を避ける）。
const CP_PATTERNS = [
  { re: /\bmkdir\s+-p\b/, msg: "mkdir -p（→ fs.mkdirSync recursive）" },
  { re: /\bln\s+-s\b/, msg: "ln -s（→ fs.symlinkSync ＋ EPERM フォールバック）" },
  { re: /\brm\s+-rf\b/, msg: "rm -rf（→ fs.rmSync force, 対象限定）" },
  { re: /(^|[^.\w])cp\s+-?[a-z]*\s/i, msg: "cp（→ fs.copyFileSync）" },
  { re: /\btouch\s+[^\s]/, msg: "touch（→ Write/fs.writeFileSync）" },
  { re: /\bchmod\b/, msg: "chmod（権限ビットに機密を依存させない）" },
  { re: /(^|[^.\w])(cat|sed|awk)\s/, msg: "cat/sed/awk での読み書き（→ Read/Write/fs）" },
  { re: /\.split\(\s*["']\\r\\n["']\s*\)/, msg: 'split("\\r\\n") 固定（→ /\\r?\\n/）' },
  { re: /["']~\//, msg: '"~/" 直書き（→ os.homedir()/環境変数）' },
];

function buildSignals(byFile, nameMap, kinds) {
  const cross_platform = [];
  const permissions = [];
  const docs_anchors = [];
  const failopen = [];

  // ファイル横断フラグ
  const touched = new Set([...byFile.keys(), ...nameMap.keys()]);
  const hasPath = (re) => [...touched].some((p) => re.test(p.replace(/\\/g, "/")));

  for (const [p, diff] of byFile) {
    const kind = kinds.get(p) || classifyKind(p);
    const status = nameMap.get(p) || "M";

    // (1) クロスプラットフォーム（.js のみ・コメント行は説明文での誤検知を避けるため除外）
    if (isJs(p)) {
      for (const { line, text } of diff.added) {
        if (/^\s*(\/\/|\/\*|\*)/.test(text)) continue; // コメント行はスキップ
        for (const { re, msg } of CP_PATTERNS) {
          if (re.test(text)) {
            cross_platform.push({ file: p, line, hit: msg, snippet: text.trim().slice(0, 160) });
          }
        }
      }
    }

    // (2) 権限境界の変更（settings.json の追加された文字列リテラル行を候補に）
    if (/settings(\.local)?\.json$/.test(p)) {
      for (const { line, text } of diff.added) {
        const t = text.trim();
        const m = t.match(/^"([^"]+)"\s*,?$/); // "Bash(...)" のような許可エントリ行
        if (m) permissions.push({ file: p, line, entry: m[1] });
      }
    }

    // (4) docs 見出しアンカー / frontmatter の削除・変更（アンカー切れ候補）
    if (kind === "docs") {
      for (const { text } of diff.removed) {
        if (/^#{2,3}\s+\S/.test(text)) docs_anchors.push({ file: p, removed_heading: text.trim() });
        if (/^---\s*$/.test(text) || /^[a-zA-Z_-]+:\s/.test(text))
          docs_anchors.push({ file: p, removed_frontmatter: text.trim() });
      }
    }

    // (5) fail-open ヒューリスティック（新規 .js のみ。追加行＝全文とみなす）
    if (status === "A" && isJs(p) && (kind === "hook" || kind === "script")) {
      const body = diff.added.map((a) => a.text).join("\n");
      const hasTry = /\btry\b/.test(body) && /\bcatch\b/.test(body);
      const hasExit0 = /process\.exit\(\s*0\s*\)/.test(body) || /\bexit\s+0\b/.test(body);
      if (!hasTry && !hasExit0) {
        failopen.push({ file: p, note: "新規 .js に try/catch も exit 0 も見当たらない（fail-open 確認）" });
      }
    }
  }

  // (3) PII 3層同期（pre-tool-use.js ↔ .gitleaks.toml）
  const piiChanged = hasPath(/hooks\/pre-tool-use\.js$/);
  const gitleaksChanged = hasPath(/\.gitleaks\.toml$/);
  const pii_sync = [];
  if (piiChanged && !gitleaksChanged)
    pii_sync.push("pre-tool-use.js を変更したが .gitleaks.toml は未変更（検知パターンの3層同期を確認）");
  if (gitleaksChanged && !piiChanged)
    pii_sync.push(".gitleaks.toml を変更したが pre-tool-use.js は未変更（実行時検知との同期を確認）");

  // (新規フック追加)
  const new_hooks = [];
  for (const [p, st] of nameMap) {
    if (st === "A" && /hooks\/.+\.js$/.test(p)) new_hooks.push(p);
  }
  if (hasPath(/hooks\.json$/)) new_hooks.push("hooks.json（matcher/登録の変更あり）");

  // (バージョン同期)
  const pluginChanged = hasPath(/plugin\.json$/);
  const marketChanged = hasPath(/marketplace\.json$/);
  let version_sync = null;
  if (pluginChanged !== marketChanged) {
    version_sync = pluginChanged
      ? "plugin.json を変更したが marketplace.json は未変更（version の 2 ファイル同期を確認）"
      : "marketplace.json を変更したが plugin.json は未変更（version の 2 ファイル同期を確認）";
  }

  return { cross_platform, permissions, pii_sync, new_hooks, failopen, version_sync, docs_anchors };
}

// ---- node --check（変更/追加の .js を構文チェック）---------------------------
function runNodeCheck(nameMap) {
  const results = [];
  for (const [p, st] of nameMap) {
    if (st === "D") continue;
    if (!isJs(p)) continue;
    const abs = path.join(ROOT, p);
    if (!fs.existsSync(abs)) continue;
    try {
      execFileSync(process.execPath, ["--check", abs], { stdio: ["ignore", "ignore", "pipe"] });
      results.push({ file: p, ok: true });
    } catch (e) {
      const err = (e && e.stderr ? e.stderr.toString() : String(e && e.message)) || "syntax error";
      results.push({ file: p, ok: false, error: err.split(/\r?\n/).slice(0, 4).join(" ").slice(0, 400) });
    }
  }
  return results;
}

// ---- 新規機能の frontmatter 抽出 ---------------------------------------------
function extractFrontmatter(absPath) {
  try {
    const text = fs.readFileSync(absPath, "utf8");
    const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const lines = m[1].split(/\r?\n/);
    const fm = {};
    for (let i = 0; i < lines.length; i++) {
      const mm = lines[i].match(/^([a-zA-Z_-]+):\s*(.*)$/);
      if (!mm) continue;
      const key = mm[1];
      let val = mm[2];
      if (/^[>|][-+]?$/.test(val.trim())) {
        // YAML folded/literal block（`description: >` 等）: 後続のインデント行を集約
        const buf = [];
        while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
          buf.push(lines[++i].trim());
        }
        val = buf.join(" ").trim();
      } else {
        val = val.replace(/^["']+|["']+$/g, "").trim();
      }
      fm[key] = val;
    }
    return fm;
  } catch {
    return {};
  }
}

function extractFeatures(nameMap) {
  const features = [];
  for (const [p, st] of nameMap) {
    if (st !== "A") continue;
    const abs = path.join(ROOT, p);
    if (/commands\/[^/]+\.md$/.test(p)) {
      const fm = extractFrontmatter(abs);
      features.push({ type: "command", name: basename(p), description: fm.description || "", argument_hint: fm["argument-hint"] || "" });
    } else if (/skills\/[^/]+\/SKILL\.md$/.test(p)) {
      const fm = extractFrontmatter(abs);
      features.push({ type: "skill", name: fm.name || basename(path.dirname(p)), description: fm.description || "" });
    }
  }
  return features;
}

// ---- 組み立て ----------------------------------------------------------------
function buildResult() {
  const diff = getDiff();
  if (!diff) return emptyResult("差分が取得できませんでした（git/gh の実行に失敗、または対象なし）");

  const byFile = parsePatch(diff.patch);
  const nameMap = parseNameStatus(diff.nameStatus);

  // patch にしか現れないファイル（rename 等）も name-status へ寄せる
  for (const p of byFile.keys()) if (!nameMap.has(p)) nameMap.set(p, "M");

  // untracked（新規未追跡）を「全行追加（A）」として合成する
  for (const p of getUntracked()) {
    if (nameMap.has(p)) continue;
    nameMap.set(p, "A");
    if (TEXT_EXT.test(p)) {
      try {
        const lines = fs.readFileSync(path.join(ROOT, p), "utf8").split(/\r?\n/);
        byFile.set(p, { added: lines.map((t, i) => ({ line: i + 1, text: t })), removed: [] });
      } catch {
        /* 読めないファイルは内容解析なしで files にだけ載せる */
      }
    }
  }

  const kinds = new Map();
  const files = [];
  for (const [p, st] of nameMap) {
    const kind = classifyKind(p);
    kinds.set(p, kind);
    const d = byFile.get(p);
    files.push({ path: p, kind, status: st, added_lines: d ? d.added.length : 0 });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  const signals = buildSignals(byFile, nameMap, kinds);
  const node_check = runNodeCheck(nameMap);
  const features = extractFeatures(nameMap);

  return {
    generated_at: new Date().toISOString(),
    base: diff.baseRef,
    mode,
    file_count: files.length,
    files,
    signals,
    node_check,
    features,
    note: files.length === 0 ? "対象差分がありません（クリーンな作業ツリー、または base と一致）" : undefined,
  };
}

function emptyResult(note) {
  return {
    generated_at: new Date().toISOString(),
    base,
    mode,
    file_count: 0,
    files: [],
    signals: { cross_platform: [], permissions: [], pii_sync: [], new_hooks: [], failopen: [], version_sync: null, docs_anchors: [] },
    node_check: [],
    features: [],
    note: note || "no diff",
  };
}

// ---- 出力（fail-open）--------------------------------------------------------
try {
  process.stdout.write(JSON.stringify(buildResult(), null, 2) + "\n");
} catch (e) {
  try {
    process.stdout.write(JSON.stringify(emptyResult("内部エラー: " + (e && e.message)), null, 2) + "\n");
  } catch {
    /* それでも失敗したら何も出さない */
  }
}
process.exit(0);
