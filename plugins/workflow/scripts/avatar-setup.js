#!/usr/bin/env node
//
// Belta workflow plugin — 育成アバター 初期設定（名前 + 画像アップロード）
//
// オンボーディング（/workflow-setup の Step 1.6）や /avatar から呼ばれ、アバターの
// 名前と任意のポートレート画像を登録する。画像は <belta>/avatar/base.<ext> に複製し、
// 名前・画像ファイル名を <belta>/avatar.yaml（profile.md と分離）に保存する。
//
// 使い方:
//   node avatar-setup.js --name "<名前>" [--image <元画像の絶対パス>] [--dir <.beltaベース>]
//     --name   アバター名（未指定なら既存を保持、無ければ "あいぼう"）
//     --image  ポートレート画像（任意）。png/jpg/jpeg/webp/gif/svg のみ、2MB 以下。
//     --clear-image  既存画像の登録を解除（base 画像は残るが avatar.yaml から外す）
//
// 設計（cross-platform.md / fail-open）:
//   - Node.js のみ。fs/path/os。OS 依存コマンド不使用。画像複製は fs.copyFileSync。
//   - 画像コピーに失敗しても名前だけは保存し JSON を返して exit 0（セッションを妨げない）。
//   - 結果は JSON で stdout（{ ok, name, image_file, message }）。

const fs = require("fs");
const path = require("path");
const os = require("os");

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}

const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
const MAX_BYTES = 2 * 1024 * 1024;

// ---- 引数 --------------------------------------------------------------------
const argv = process.argv.slice(2);
let name = null;
let image = null;
let dirOverride = null;
let clearImage = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--name") name = argv[++i];
  else if (a === "--image") image = argv[++i];
  else if (a === "--dir") dirOverride = argv[++i];
  else if (a === "--clear-image") clearImage = true;
}

const beltaDir = dirOverride || path.join(homeDir(), ".belta");
const avatarDir = path.join(beltaDir, "avatar");
const yamlPath = path.join(beltaDir, "avatar.yaml");

// ---- flat YAML I/O（belta-init.js と同じ作法）-------------------------------
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
function formatValue(v) {
  const s = String(v == null ? "" : v);
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function readYaml() {
  try {
    return parseYaml(fs.readFileSync(yamlPath, "utf8"));
  } catch {
    return {};
  }
}
function writeYaml(map) {
  fs.mkdirSync(beltaDir, { recursive: true });
  const order = ["name", "image_file", "created_at", "updated_at"];
  const keys = order.filter((k) => k in map).concat(Object.keys(map).filter((k) => !order.includes(k)));
  const lines = ["# Belta avatar 設定（machine-readable）。/avatar や avatar-setup.js で更新。"];
  for (const k of keys) lines.push(`${k}: ${formatValue(map[k])}`);
  const tmp = yamlPath + ".tmp";
  fs.writeFileSync(tmp, lines.join("\n") + "\n");
  fs.renameSync(tmp, yamlPath);
}

function nowIso() {
  return new Date().toISOString();
}

// ---- メイン ------------------------------------------------------------------
function main() {
  const existing = readYaml();
  const result = { ok: true, name: existing.name || "", image_file: existing.image_file || "", message: "" };
  const messages = [];

  // 名前
  if (name && String(name).trim()) result.name = String(name).trim().slice(0, 40);
  if (!result.name) result.name = "あいぼう";

  // 画像
  if (clearImage) {
    result.image_file = "";
    messages.push("画像の登録を解除しました。");
  } else if (image && String(image).trim()) {
    const src = String(image).trim();
    const ext = path.extname(src).slice(1).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      messages.push(`画像形式 .${ext} は非対応です（png/jpg/jpeg/webp/gif/svg のみ）。名前のみ保存しました。`);
    } else {
      try {
        const stat = fs.statSync(src);
        if (stat.size > MAX_BYTES) {
          messages.push(`画像が大きすぎます（${Math.round(stat.size / 1024)}KB > 2MB）。小さい画像を指定してください。名前のみ保存しました。`);
        } else {
          fs.mkdirSync(avatarDir, { recursive: true });
          const destName = `base.${ext}`;
          fs.copyFileSync(src, path.join(avatarDir, destName));
          result.image_file = destName;
          messages.push(`画像を登録しました（${destName}）。`);
        }
      } catch (e) {
        messages.push(`画像の読み込みに失敗しました（${src}）。名前のみ保存しました。`);
      }
    }
  }

  // 保存
  const toSave = {
    name: result.name,
    image_file: result.image_file,
    created_at: existing.created_at || nowIso(),
    updated_at: nowIso(),
  };
  try {
    writeYaml(toSave);
  } catch {
    result.ok = false;
    messages.push("avatar.yaml の保存に失敗しました。");
  }

  result.message = messages.join(" ") || "アバター設定を保存しました。";
  return result;
}

let out;
try {
  out = main();
} catch {
  out = { ok: false, name: "", image_file: "", message: "予期せぬエラー（設定はスキップされました）。" };
}
process.stdout.write(JSON.stringify(out) + "\n");
process.exit(0);
