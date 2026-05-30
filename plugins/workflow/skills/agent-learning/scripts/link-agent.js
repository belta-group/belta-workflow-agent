#!/usr/bin/env node
//
// Belta workflow plugin — agent-learning 用 symlink/コピー ヘルパー
//
// 自動生成した subagent 正本（~/.belta/agents/<slug>.md）を、Claude Code が
// 標準 Agent ツールで認識する ~/.claude/agents/<slug>.md として公開する。
//
// クロスプラットフォーム方針:
//   - symlink を第一候補にするが、Windows では管理者権限 / 開発者モードが無いと
//     ファイル symlink に失敗する。EPERM 等で失敗したら **コピー** にフォールバックする。
//   - ホーム解決は os.homedir()、パス連結は path.join に委ね、区切り文字を直書きしない。
//   - 例外時も JSON を返して exit 0（呼び出し側の判断を妨げない）。
//
// 使い方:
//   node link-agent.js link <slug>   … 正本を ~/.claude/agents/<slug>.md として公開
//   node link-agent.js check         … adopted 済み各エージェントのリンク健全性を返す
//
// 出力は常に 1 行の JSON。

const fs = require("fs");
const os = require("os");
const path = require("path");

const home = os.homedir();
const srcDir = path.join(home, ".belta", "agents");
const dstDir = path.join(home, ".claude", "agents");

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

// slug を安全な単一ファイル名に正規化（パストラバーサル防止）
function safeSlug(raw) {
  if (typeof raw !== "string") return null;
  const base = path.basename(raw).replace(/\.md$/i, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(base)) return null;
  return base;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// 既存の公開先を取り除く（symlink・実ファイルの両方に対応）
function removeIfExists(target) {
  try {
    const st = fs.lstatSync(target);
    if (st) fs.rmSync(target, { force: true });
  } catch (_) {
    // 無ければ何もしない
  }
}

function link(slugRaw) {
  const slug = safeSlug(slugRaw);
  if (!slug) out({ ok: false, error: "invalid slug" });

  const src = path.join(srcDir, slug + ".md");
  const dst = path.join(dstDir, slug + ".md");

  if (!fs.existsSync(src)) out({ ok: false, slug, error: "source not found", src });

  try {
    ensureDir(dstDir);
    removeIfExists(dst);
    try {
      // 'file' 種別を明示（Windows でディレクトリ symlink と誤認させない）
      fs.symlinkSync(src, dst, "file");
      out({ ok: true, slug, mode: "symlink", target: dst });
    } catch (symErr) {
      // symlink 不可（Windows 権限等）→ コピーにフォールバック
      fs.copyFileSync(src, dst);
      out({ ok: true, slug, mode: "copy", target: dst, note: "symlink unavailable; copied", reason: String(symErr && symErr.code || symErr) });
    }
  } catch (e) {
    out({ ok: false, slug, error: String(e && e.message || e) });
  }
}

function listSlugs(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.md$/i.test(f) && !/^(AGENTS|RULES|SKILLS)\.md$/i.test(f))
      .map((f) => f.replace(/\.md$/i, ""));
  } catch (_) {
    return [];
  }
}

function check() {
  // 正本（srcDir）と公開先（dstDir）双方の slug を和集合で評価する。
  // 片方にしか無いケース（user 削除 / dangling）を取りこぼさないため。
  const slugs = Array.from(new Set([...listSlugs(srcDir), ...listSlugs(dstDir)])).sort();
  const results = [];

  for (const slug of slugs) {
    const src = path.join(srcDir, slug + ".md");
    const dst = path.join(dstDir, slug + ".md");
    const hasSrc = fs.existsSync(src);

    let lst = null;
    try {
      lst = fs.lstatSync(dst); // 公開先のリンク自体（symlink でも実体を辿らない）
    } catch (_) {
      lst = null;
    }

    let status;
    let mode = null;
    if (!lst) {
      // 公開先が無い → 利用者が削除した（正本は残っている）
      status = "deleted";
    } else {
      mode = lst.isSymbolicLink() ? "symlink" : "copy";
      // 公開先はある。正本が生きていれば ok、消えていれば broken（dangling）
      status = hasSrc ? "ok" : "broken";
    }
    results.push({ slug, status, mode });
  }

  out({ ok: true, agents: results });
}

const [, , cmd, arg] = process.argv;
if (cmd === "link") link(arg);
else if (cmd === "check") check();
else out({ ok: false, error: "usage: link <slug> | check" });
