#!/usr/bin/env node
//
// Belta workflow plugin — skill-authoring 用 symlink/コピー ヘルパー（ディレクトリ対応）
//
// 自作スキルの正本（~/.belta/skills/<name>/）を、Claude Code が標準で認識する
// ~/.claude/skills/<name>/ として公開する。link-agent.js が単一 .md ファイルを
// 対象にするのに対し、スキルは SKILL.md + references/ + scripts/ を含む
// **ディレクトリ**なので、ディレクトリ symlink（不可なら再帰コピー）で公開する。
//
// クロスプラットフォーム方針（cross-platform.md §4 準拠）:
//   - ディレクトリ symlink を第一候補にするが、Windows では管理者権限 / 開発者モードが
//     無いと失敗する。EPERM 等で失敗したら **再帰コピー** にフォールバックする。
//   - ホーム解決は os.homedir()、パス連結は path.join に委ね、区切り文字を直書きしない。
//   - 例外時も JSON を返して exit 0（呼び出し側の判断を妨げない）。
//
// 使い方:
//   node link-skill.js link <name>   … 正本を ~/.claude/skills/<name>/ として公開
//   node link-skill.js check         … 公開済み各スキルのリンク健全性を返す
//
// 出力は常に 1 行の JSON。
//
// 注意: ~/.belta/skills/ 直下には skill-suggestion の索引 SKILLS.md と本スキルの
//       索引 AUTHORED.md が同居する。これらは「スキル本体ディレクトリ」ではないため、
//       走査時に必ず除外する（SKILL.md を含むサブディレクトリのみを自作スキルと見なす）。

const fs = require("fs");
const os = require("os");
const path = require("path");

const home = os.homedir();
const srcDir = path.join(home, ".belta", "skills");
const dstDir = path.join(home, ".claude", "skills");

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

// name を安全な単一ディレクトリ名に正規化（パストラバーサル防止）
function safeName(raw) {
  if (typeof raw !== "string") return null;
  const base = path.basename(raw);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(base)) return null;
  return base;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// 既存の公開先を取り除く（ディレクトリ symlink・実ディレクトリの両方に対応）
function removeIfExists(target) {
  let st;
  try {
    st = fs.lstatSync(target);
  } catch (_) {
    return; // 無ければ何もしない
  }
  // symlink はリンク自体だけを外す（参照先の正本を消さない）。
  if (st.isSymbolicLink()) {
    try {
      fs.unlinkSync(target);
    } catch (_) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  } else {
    // 実ディレクトリ（過去のコピー）→ 中身ごと除去
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function link(nameRaw) {
  const name = safeName(nameRaw);
  if (!name) out({ ok: false, error: "invalid name" });

  const src = path.join(srcDir, name);
  const dst = path.join(dstDir, name);

  // 正本はディレクトリで、かつ SKILL.md を含むこと。
  if (!fs.existsSync(path.join(src, "SKILL.md"))) {
    out({ ok: false, name, error: "source skill not found (SKILL.md missing)", src });
  }

  try {
    ensureDir(dstDir);
    removeIfExists(dst);
    try {
      // 'dir' 種別を明示（Windows でファイル symlink と誤認させない）
      fs.symlinkSync(src, dst, "dir");
      out({ ok: true, name, mode: "symlink", target: dst });
    } catch (symErr) {
      // symlink 不可（Windows 権限等）→ 再帰コピーにフォールバック
      fs.cpSync(src, dst, { recursive: true });
      out({
        ok: true,
        name,
        mode: "copy",
        target: dst,
        note: "symlink unavailable; copied recursively",
        reason: String((symErr && symErr.code) || symErr),
      });
    }
  } catch (e) {
    out({ ok: false, name, error: String((e && e.message) || e) });
  }
}

// ディレクトリ内のエントリ名を返す。
//   - srcDir（~/.belta/skills/）: サブディレクトリ全部（索引ファイル SKILLS.md /
//     AUTHORED.md は file なので自然に除外）。SKILL.md の有無は問わない
//     ＝正本の SKILL.md が壊れた broken ケースも取りこぼさないため。
//   - dstDir（~/.claude/skills/）: **symlink エントリのみ**。ここは他ソースの
//     個人スキル（実ディレクトリ）が同居しうるので、本ヘルパーが張った symlink
//     だけを自作スキルと見なし、無関係な実ディレクトリを誤って claim しない。
function listSkills(dir, opts) {
  const symlinkOnly = !!(opts && opts.symlinkOnly);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const names = [];
  for (const ent of entries) {
    if (ent.isFile()) continue; // 索引ファイル等は除外
    if (symlinkOnly) {
      if (ent.isSymbolicLink()) names.push(ent.name);
    } else {
      names.push(ent.name);
    }
  }
  return names;
}

function check() {
  // 正本（srcDir のサブディレクトリ）と、公開先の symlink エントリの和集合で評価する。
  // 片方にしか無いケース（user 削除 / dangling symlink）を取りこぼさないため。
  const names = Array.from(
    new Set([...listSkills(srcDir), ...listSkills(dstDir, { symlinkOnly: true })])
  ).sort();
  const results = [];

  for (const name of names) {
    const src = path.join(srcDir, name);
    const dst = path.join(dstDir, name);
    const hasSrc = fs.existsSync(path.join(src, "SKILL.md"));

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
    results.push({ name, status, mode });
  }

  out({ ok: true, skills: results });
}

const [, , cmd, arg] = process.argv;
if (cmd === "link") link(arg);
else if (cmd === "check") check();
else out({ ok: false, error: "usage: link <name> | check" });
