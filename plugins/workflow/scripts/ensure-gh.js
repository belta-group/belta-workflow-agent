#!/usr/bin/env node
//
// Belta workflow plugin — gh CLI（GitHub CLI）自動導入ヘルパー
//
// gh の有無を検出し、未導入なら OS 標準のパッケージマネージャで自動導入する。
//   macOS  : Homebrew（brew install gh）
//   Windows: winget（winget install --id GitHub.cli）
// パッケージマネージャ不在・非対応 OS では、手動導入手順を案内する（自動実行しない）。
//
// 使い方:
//   node ensure-gh.js            有無を確認し、未導入なら自動導入を試みる（既定動作）
//   node ensure-gh.js check      確認のみ（導入はしない）
//   node ensure-gh.js install    明示的に導入を試みる
//
// 設計（クロスプラットフォーム規約 §1/§3/§4/§7）:
//   - シェル非依存の Node.js 単一実装。OS 分岐は os.platform() で内包し、.sh/.ps1 を二重メンテしない。
//   - インストール手段は OS 標準 PM のみ。sudo は使わない（settings.json で deny + 安全側に倒す）。
//   - 例外時も落とさず、常に JSON で状態を返し終了コード 0。導入可否の判断は呼び出し側（手順/エージェント）に委ねる。

const { spawnSync } = require("child_process");
const os = require("os");

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

// ---- 検出 --------------------------------------------------------------------

// gh の有無とバージョンを検出する。ENOENT（未導入）でも例外にせず false を返す。
function detectGh() {
  try {
    const r = spawnSync("gh", ["--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0 && r.stdout) {
      const m = r.stdout.match(/gh version\s+(\S+)/);
      return { installed: true, version: m ? m[1] : null };
    }
  } catch (_) {
    /* fall through */
  }
  return { installed: false, version: null };
}

// 指定コマンドが PATH 上に存在するか。r.error（ENOENT）が無ければ存在とみなす。
function commandExists(cmd, versionArgs) {
  try {
    const r = spawnSync(cmd, versionArgs || ["--version"], { encoding: "utf8" });
    return !r.error;
  } catch (_) {
    return false;
  }
}

// ---- 導入 --------------------------------------------------------------------

// OS に応じたパッケージマネージャで gh を導入する。実行可否と結果を返す。
function installGh() {
  const platform = os.platform();

  if (platform === "darwin") {
    if (commandExists("brew")) {
      const r = spawnSync("brew", ["install", "gh"], { stdio: "inherit" });
      return { attempted: true, installer: "brew", ok: r.status === 0 };
    }
    return {
      attempted: false,
      installer: null,
      guidance:
        "Homebrew が未導入のため自動導入できません。https://cli.github.com の公式インストーラを使うか、先に Homebrew を導入してから再実行してください。",
    };
  }

  if (platform === "win32") {
    if (commandExists("winget", ["--version"])) {
      const r = spawnSync(
        "winget",
        [
          "install",
          "--id",
          "GitHub.cli",
          "-e",
          "--source",
          "winget",
          "--accept-source-agreements",
          "--accept-package-agreements",
        ],
        { stdio: "inherit" }
      );
      return { attempted: true, installer: "winget", ok: r.status === 0 };
    }
    return {
      attempted: false,
      installer: null,
      guidance:
        "winget が未導入のため自動導入できません。https://cli.github.com の公式インストーラを使ってください（または winget を有効化）。",
    };
  }

  // Linux ほかは sudo を要する経路が多く、安全側に倒して自動実行しない。
  return {
    attempted: false,
    installer: null,
    guidance:
      "この OS では自動導入に対応していません。https://cli.github.com の手順に従って gh を導入してください。",
  };
}

// ---- メイン ------------------------------------------------------------------

function main() {
  const cmd = (process.argv[2] || "ensure").toLowerCase();
  const before = detectGh();

  // すでに導入済みなら何もしない。
  if (before.installed) {
    out({
      ok: true,
      installed: true,
      version: before.version,
      action: "none",
      message: `gh は導入済みです（version ${before.version}）。続けて \`gh auth login --web\` で認証してください。`,
    });
    return;
  }

  // 確認のみ。
  if (cmd === "check") {
    out({
      ok: false,
      installed: false,
      action: "none",
      message:
        "gh は未導入です。`node ensure-gh.js`（引数なし）で自動導入を試みられます。",
    });
    return;
  }

  // ensure / install: 自動導入を試みる。
  const result = installGh();
  if (!result.attempted) {
    out({
      ok: false,
      installed: false,
      action: "guidance",
      installer: null,
      message: result.guidance,
    });
    return;
  }

  const after = detectGh();
  out({
    ok: after.installed,
    installed: after.installed,
    version: after.version,
    action: "install",
    installer: result.installer,
    message: after.installed
      ? `gh を ${result.installer} で導入しました（version ${after.version}）。続けて \`gh auth login --web\` で認証してください。`
      : `${result.installer} での導入に失敗しました。https://cli.github.com の手順で手動導入してください。`,
  });
}

try {
  main();
} catch (e) {
  // §7: 例外時も落とさず、状態を JSON で返す。
  out({
    ok: false,
    installed: false,
    action: "error",
    message: `自動導入の確認中にエラーが発生しました: ${e && e.message ? e.message : String(e)}。https://cli.github.com の手順で手動導入してください。`,
  });
}

process.exit(0);
