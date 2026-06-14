#!/usr/bin/env node
//
// BELTA workflow plugin — スタンドアロン・インストーラー（Mac / Windows 両対応）
//
// 単体（`node scripts/install.js`）で、専用フォルダの作成から初期化までを一気通貫で行う
// 独立インストーラー。仕様:
//
//   1. メールアドレスを入力させる（readline の標準入力プロンプト。`--email` で非対話実行も可）。
//   2. 入力したメールアドレスのドメインが `belta.co.jp` であることを検証する（不一致は再入力／中止）。
//   3. メールアドレスの「@ より前（ローカルパート）」＋ `-agent` をフォルダ名とし、
//      ホームディレクトリ直下（POSIX:$HOME / Windows:%USERPROFILE%）に作成する。
//   4. そのフォルダへ本プラグインを「展開」（＝ローカル有効化 + 権限ポリシー + 自動更新）し、
//      初期化処理（`~/.belta/` と config.yaml の生成）を走らせる。
//
// 使い方:
//   node scripts/install.js                         対話（メールを標準入力で聞く）
//   node scripts/install.js --email system-bot@belta.co.jp   非対話（CI / 検証用）
//   node scripts/install.js --base <dir>            作成基点を上書き（既定はホーム。検証用）
//   node scripts/install.js --dry-run               実際には書き込まず予定だけ表示
//   node scripts/install.js --ref <branch|tag>      marketplace 参照 ref を固定
//   共通: --max-attempts <n>（対話時の再入力回数。既定 3）
//
// 設計（cross-platform.md 準拠）:
//   - シェル非依存の Node.js 単一実装。OS 依存コマンド（mkdir -p / cp / ln -s）を使わない。
//   - パスは path.join、ホームは環境変数 / os.homedir() から解決。
//   - 重い処理（settings マージ・権限・初期化）は既存スクリプトを node→node で spawn して再利用し、
//     マージ等のロジックを二重実装しない（単一の権威ソースを保つ）。
//   - 必須ステップ（フォルダ作成・初期化）失敗は中止、付随ステップ（権限・自動更新）失敗は
//     警告のみで継続（fail-open）。

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { spawnSync } = require("child_process");

// ---- 引数パース --------------------------------------------------------------
const argv = process.argv.slice(2);
let emailArg = null;
let baseOverride = null;
let refOverride = null;
let dryRun = false;
let maxAttempts = 3;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--email") emailArg = argv[++i];
  else if (a === "--base") baseOverride = argv[++i];
  else if (a === "--ref") refOverride = argv[++i];
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--max-attempts") maxAttempts = parseInt(argv[++i], 10) || 3;
  else if (a === "-h" || a === "--help") {
    printUsage();
    process.exit(0);
  }
}

function printUsage() {
  process.stdout.write(
    [
      "BELTA workflow installer",
      "  node scripts/install.js [--email system-bot@belta.co.jp] [--base <dir>]",
      "                          [--ref <branch|tag>] [--dry-run] [--max-attempts <n>]",
      "",
    ].join("\n")
  );
}

// ---- パス解決 ----------------------------------------------------------------
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}
const base = baseOverride ? path.resolve(baseOverride) : homeDir();
const scriptsDir = __dirname;

// ---- メール検証 / フォルダ名生成 --------------------------------------------
const REQUIRED_DOMAIN = "belta.co.jp";

// ドメインが REQUIRED_DOMAIN（大小無視・完全一致）であることを検証し、ローカルパートを返す。
// 無効な場合は { ok:false, reason } を返す（呼び出し側でメッセージ提示）。
function validateEmail(raw) {
  const email = String(raw == null ? "" : raw).trim();
  if (!email) return { ok: false, reason: "メールアドレスが空です。" };
  const m = email.match(/^([^\s@]+)@([^\s@]+)$/);
  if (!m) return { ok: false, reason: `メールアドレスの形式が不正です: ${email}` };
  const localPart = m[1];
  const domain = m[2].toLowerCase();
  if (domain !== REQUIRED_DOMAIN) {
    return {
      ok: false,
      reason: `ドメインが ${REQUIRED_DOMAIN} ではありません（入力: @${domain}）。${REQUIRED_DOMAIN} のアドレスを使ってください。`,
    };
  }
  return { ok: true, email, localPart, domain };
}

// ローカルパートをファイルシステムで安全なフォルダ名要素へ整える。
// 許可文字は [A-Za-z0-9._-]。それ以外は "-" に置換し、連続/前後の "-." を整理する。
function toFolderBase(localPart) {
  let s = localPart.replace(/[^A-Za-z0-9._-]/g, "-");
  s = s.replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return s;
}

// ---- 対話プロンプト ----------------------------------------------------------
// readline を 1 つだけ生成し、入力行をキューに退避してから ask() で 1 行ずつ取り出す。
// パイプ入力では複数の "line" イベントが await ループより速く連続発火するため、
// その場で待つだけだと未登録の行を取りこぼす。いったん queue に貯めて順に消費する。
// EOF（標準入力が尽きた／無入力環境）では null を返し、ハングを避ける。
function makeAsker() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const queue = []; // 受信済みで未消費の行
  const waiters = []; // 行を待っている resolver
  let closed = false;
  rl.on("line", (line) => {
    if (waiters.length) waiters.shift()(line);
    else queue.push(line);
  });
  rl.on("close", () => {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  });
  const ask = (question) =>
    new Promise((resolve) => {
      process.stdout.write(question);
      if (queue.length) return resolve(queue.shift());
      if (closed) return resolve(null);
      waiters.push(resolve);
    });
  return { ask, close: () => rl.close() };
}

// メールを取得（--email 優先。無ければ標準入力プロンプトで最大 maxAttempts 回まで聞く）。
async function resolveEmail() {
  if (emailArg != null) {
    const v = validateEmail(emailArg);
    if (!v.ok) {
      fail(`--email の値が無効です。${v.reason}`);
    }
    return v;
  }
  const asker = makeAsker();
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ans = await asker.ask(`メールアドレスを入力してください（@${REQUIRED_DOMAIN}）: `);
      const v = validateEmail(ans);
      if (v.ok) return v;
      process.stdout.write(`  ✗ ${v.reason}\n`);
    }
  } finally {
    asker.close();
  }
  fail(`メールアドレスの検証に ${maxAttempts} 回失敗しました。中止します。`);
}

// ---- 子スクリプト実行（node→node） ------------------------------------------
function runScript(name, args) {
  const scriptPath = path.join(scriptsDir, name);
  const res = spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });
  return res;
}

function fail(message) {
  process.stderr.write(`\n[install] エラー: ${message}\n`);
  process.exit(1);
}

function warn(message) {
  process.stdout.write(`[install] 警告: ${message}\n`);
}

// ---- メイン ------------------------------------------------------------------
(async () => {
  const { email, localPart } = await resolveEmail();

  const folderBase = toFolderBase(localPart);
  if (!folderBase) {
    fail(`メールのローカルパート「${localPart}」から有効なフォルダ名を作れませんでした。`);
  }
  const folderName = `${folderBase}-agent`;
  const folder = path.join(base, folderName);

  process.stdout.write(`\n[install] メール: ${email}\n`);
  process.stdout.write(`[install] 作成フォルダ: ${folder}\n`);
  if (dryRun) process.stdout.write(`[install] （--dry-run: 実際には書き込みません）\n`);
  process.stdout.write("\n");

  // --- Step A: 専用フォルダ作成 + プラグインのローカル有効化（必須） ---
  process.stdout.write("[install] (1/4) 専用フォルダ作成 + ローカル有効化 …\n");
  {
    const args = ["--dir", folder];
    if (refOverride) args.push("--ref", refOverride);
    if (dryRun) args.push("--dry-run");
    const res = runScript("setup-agent-home.js", args);
    if (res.status !== 0) {
      fail(`setup-agent-home.js が異常終了しました。\n${res.stderr || res.stdout || ""}`);
    }
    // setup-agent-home.js は stdout に JSON オブジェクトを 1 つ返す
    // （成功時は 1 行、--dry-run 時は pretty 複数行）。まず全体を、駄目なら末尾行をパース。
    let parsed = null;
    const out = (res.stdout || "").trim();
    try {
      parsed = out ? JSON.parse(out) : null;
    } catch {
      try {
        const last = out.split(/\r?\n/).filter(Boolean).pop();
        parsed = last ? JSON.parse(last) : null;
      } catch {
        /* パース不能は下で判定 */
      }
    }
    if (!parsed || parsed.ok !== true) {
      fail(`専用フォルダの有効化に失敗しました。\n${out || res.stdout || ""}`);
    }
    process.stdout.write(`        → ${parsed.reused ? "既存フォルダを再利用" : "新規作成"}: ${parsed.path}\n`);
  }

  // --- Step B: ~/.belta 初期化 + メール記録（必須） ---
  process.stdout.write("[install] (2/4) ~/.belta 初期化 + config 記録 …\n");
  if (!dryRun) {
    const args = ["init", "--owner-email", email, "--agent-home", folder];
    // 検証用に --base を渡したときは .belta も同じ基点へ隔離する。
    if (baseOverride) args.push("--dir", path.join(base, ".belta"));
    const res = runScript("belta-init.js", args);
    if (res.status !== 0) {
      fail(`belta-init.js が異常終了しました。\n${res.stderr || res.stdout || ""}`);
    }
  } else {
    process.stdout.write("        → (--dry-run のためスキップ)\n");
  }

  // --- Step C: 権限ポリシー適用（付随・fail-open） ---
  process.stdout.write("[install] (3/4) 権限ポリシー適用 …\n");
  {
    const target = path.join(folder, ".claude", "settings.local.json");
    const args = ["--target", target];
    if (dryRun) args.push("--dry-run");
    const res = runScript("apply-permissions.js", args);
    if (res.status !== 0) {
      warn(`権限ポリシーの適用に失敗しました（継続します）。\n${res.stderr || res.stdout || ""}`);
    }
  }

  // --- Step D: marketplace 自動更新の有効化（付随・fail-open） ---
  process.stdout.write("[install] (4/4) 自動更新の有効化 …\n");
  {
    const target = path.join(folder, ".claude", "settings.local.json");
    const args = ["--target", target];
    if (refOverride) args.push("--ref", refOverride);
    if (dryRun) args.push("--dry-run");
    const res = runScript("apply-auto-update.js", args);
    if (res.status !== 0) {
      warn(`自動更新の有効化に失敗しました（継続します）。\n${res.stderr || res.stdout || ""}`);
    }
  }

  // --- 完了 ---
  process.stdout.write("\n[install] 完了しました。\n");
  if (!dryRun) {
    process.stdout.write(
      [
        "",
        "次のステップ:",
        `  1. Claude Code で専用フォルダを開く: ${folder}`,
        "  2. そのフォルダ内で /workflow-setup を実行し、プロフィール（氏名・部署など）と",
        "     MCP 4 ツール（Notion / Slack / Google Drive / GitHub）の OAuth 接続を済ませる。",
        "",
      ].join("\n")
    );
  }
  process.exit(0);
})().catch((e) => {
  fail(String((e && e.message) || e));
});
