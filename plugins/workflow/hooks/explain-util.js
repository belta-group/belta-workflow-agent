#!/usr/bin/env node
//
// BELTA workflow plugin — 許可ダイアログの「やさしい説明」共有ユーティリティ
//
// pre-tool-use.js（PreToolUse）が、これから実行されるコマンド/ツールを
// ノンエンジニア向けの平易な日本語に翻訳するためのロジック。3 段構成で、
// 列挙（ハードコード）に頼らず未知コマンドも意味づけできるようにする。
//
//   1. 辞書（known）   — 高頻度の具体コマンドに最も具体的な一文。
//   2. 型分類（type）  — コマンドを「副作用の型」で決定的に分類（外部通信 /
//                        ファイル書換 / 削除 / 権限変更 / インストール / 公開 /
//                        履歴書換）。辞書に無い未知コマンドも型レベルで説明でき、
//                        純読み取り・判定不能は null（＝呼び出し側で素通し）。
//   3. LLM フォールバック — 型は判明したが具体文が無い未知コマンドに限り、
//                        `claude -p`（haiku・MCP/ツール無効）で 1 文を生成。
//                        結果はキャッシュし、再帰ガード・タイムアウト・fail-open。
//                        config.yaml の explain_llm_fallback で無効化可（既定 on）。
//
// 設計（cross-platform.md / フックの鉄則）:
//   - Node.js のみ（fs/path/os/child_process）。ホームは環境変数から解決。
//   - 改行 /\r?\n/。OS 依存コマンドを必須経路に置かない。
//   - fail-open: どの段でも失敗したら下位段か null に落とし、決して落とさない。

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

// 子プロセス（LLM フォールバックの claude -p）から本ロジックが再発火しても
// 無限再帰しないためのガード環境変数。pre-tool-use.js の先頭でも検査する。
const SUBPROCESS_GUARD = "BELTA_EXPLAIN_SUBPROCESS";

function resolveHome() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}

function beltaDir() {
  return path.join(resolveHome(), ".belta");
}

// ---- config.yaml の真偽値キーを読む（flat YAML・依存なし）---------------------
// 未設定・読めない → def。true/1/yes/on を真、false/0/no/off を偽とみなす。
function readConfigBool(key, def) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(beltaDir(), "config.yaml"), "utf8");
  } catch {
    return def;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    if (line.slice(0, idx).trim() !== key) continue;
    let val = line.slice(idx + 1).trim().toLowerCase();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (["true", "1", "yes", "on"].includes(val)) return true;
    if (["false", "0", "no", "off"].includes(val)) return false;
    return def;
  }
  return def;
}

// ============================================================================
// 共通：接続先ホスト抽出
// ============================================================================
function extractHost(cmd) {
  const m = cmd.match(/https?:\/\/([^/\s'"]+)/i);
  if (m) return m[1];
  // user@host:path（scp/ssh/rsync）
  const m2 = cmd.match(/(?:^|\s)[\w.-]+@([\w.-]+):/);
  if (m2) return m2[1];
  // スキーム省略の curl example.com / 127.0.0.1 / localhost 形式。
  // ドメイン（.tld 付き）に加え、ベア IPv4 と localhost も拾う（拾えないと
  // ローカル接続を「インターネット送信」と誤って説明してしまうため。CLAUDE.md の
  // 代表例 `curl 127.0.0.1/hoge` → 「お使いのパソコン内…」を成立させる）。
  const m3 = cmd.match(
    /\b(?:curl|wget|http)\b[^|;&]*?\s((?:[\w.-]+\.[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3}|localhost)(?::\d+)?)(?=[/\s'"]|$)/i
  );
  return m3 ? m3[1] : null;
}

function isLocalHost(host) {
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1" || h.endsWith(".local");
}

// ============================================================================
// 段 1: 辞書（既知の高頻度コマンド → 最も具体的な一文）
// ============================================================================
function dictBash(cmd) {
  // HTTP クライアント（接続先で言い分け）
  if (/(^|[;&|]\s*)(curl|wget|http)\b/.test(cmd)) {
    const host = extractHost(cmd);
    if (isLocalHost(host)) {
      return `お使いのパソコン内で動いているプログラム（${host}）に接続して、データをやり取りします。インターネットの外部サイトへの送信ではありません。`;
    }
    if (host) {
      return `インターネット上のサービス（${host}）に接続して、データを取得または送信します。心当たりのない送信先でないか確認してください。`;
    }
    return `インターネットへの接続（データの取得・送信）を行います。送信先に心当たりがあるか確認してください。`;
  }
  // git
  if (/(^|[;&|]\s*)git\s+push\s+(--force|-f)\b/.test(cmd))
    return `このパソコンの変更を GitHub（インターネット上の保管場所）へ「強制的に」アップロードします。相手側の履歴を上書きするため特に注意が必要です。`;
  if (/(^|[;&|]\s*)git\s+push\b/.test(cmd))
    return `このパソコンに保存した変更を、GitHub（インターネット上の共有の保管場所）へアップロードします。チームに共有されます。`;
  if (/(^|[;&|]\s*)git\s+commit\b/.test(cmd))
    return `これまでの変更内容を、このパソコンの記録（変更履歴）として保存します。外部には送信しません。`;
  if (/(^|[;&|]\s*)git\s+(rebase|merge)\b/.test(cmd))
    return `変更履歴を整理・統合します（複数の変更をまとめる操作）。内容が書き換わる場合があります。`;
  if (/(^|[;&|]\s*)git\s+reset\b/.test(cmd))
    return `変更を以前の状態へ巻き戻します。保存前の変更が消える場合があるため注意してください。`;
  // gh
  if (/\bgh\s+pr\s+create\b/.test(cmd)) return `GitHub に「変更の提案（プルリクエスト）」を新しく作成します。チームに公開されます。`;
  if (/\bgh\s+pr\s+merge\b/.test(cmd)) return `GitHub の変更提案（プルリクエスト）を本体に取り込み（マージし）ます。`;
  if (/\bgh\s+(pr|issue)\s+(comment|edit)\b/.test(cmd)) return `GitHub の提案・課題（issue/PR）にコメントや編集を書き込みます。チームに見えます。`;
  if (/\bgh\s+issue\s+create\b/.test(cmd)) return `GitHub に新しい課題（やること・不具合の記録）を作成します。チームに公開されます。`;
  if (/\bgh\s+release\s+create\b/.test(cmd)) return `GitHub に新しいリリース（公開版）を作成します。外部に公開されます。`;
  if (/\bgh\s+gist\s+create\b/.test(cmd)) return `GitHub Gist（コード断片の共有ページ）を新しく作成します。`;
  if (/\bgh\s+api\b[\s\S]*--method\s+(POST|PATCH|PUT)\b/i.test(cmd)) return `GitHub のデータを書き換える操作（作成・更新）を行います。`;
  return null;
}

function dictMcp(name) {
  if (/slack_send_message_draft$/.test(name)) return `Slack に送信メッセージの「下書き」を用意します（まだ相手には届きません）。`;
  if (/slack_send_message$/.test(name)) return `Slack にメッセージを送信します。相手に届きます。`;
  if (/slack_schedule_message$/.test(name)) return `Slack に「予約投稿」（指定した時刻に自動で送るメッセージ）を設定します。`;
  if (/slack_create_canvas$/.test(name)) return `Slack のキャンバス（共有ドキュメント）を新しく作成します。`;
  if (/slack_update_canvas$/.test(name)) return `Slack のキャンバス（共有ドキュメント）の内容を書き換えます。`;
  if (/notion-create-comment$/.test(name)) return `Notion のページにコメントを書き込みます。`;
  if (/notion-create-[\w-]+$/.test(name)) return `Notion に新しいページやデータベースを作成します。`;
  if (/notion-update-[\w-]+$/.test(name)) return `Notion の既存ページ・データの内容を書き換えます。`;
  if (/notion-duplicate-page$/.test(name)) return `Notion のページを複製します。`;
  if (/notion-move-pages$/.test(name)) return `Notion のページを別の場所へ移動します。`;
  if (/create_file$/.test(name)) return `Google ドライブに新しいファイルを作成します。`;
  if (/copy_file$/.test(name)) return `Google ドライブのファイルを複製します。`;
  return null;
}

// ============================================================================
// 段 2: 型分類（副作用の型で決定的に分類）
// ============================================================================
// 戻り値: { category, host? } か null（純読み取り・判定不能）。
// 優先順位は「警告として重要な型」を先に。読み取り専用コマンドは null を返し、
// 呼び出し側で素通し（settings の allow を壊さない安全側）。
function classifyBash(cmd) {
  const c = cmd;

  // 権限・システム変更（影響大）
  if (/(^|[;&|]\s*)(sudo|su|doas)\b/.test(c)) return { category: "privilege" };
  if (/(^|[;&|]\s*)(chmod|chown|chgrp)\b/.test(c)) return { category: "privilege" };
  if (/(^|[;&|]\s*)(launchctl|systemctl|service|defaults\s+write|setx)\b/.test(c)) return { category: "privilege" };
  if (/(^|[;&|]\s*)(kill|pkill|killall)\b/.test(c)) return { category: "privilege" };

  // 削除（元に戻せない場合あり）
  if (/(^|[;&|]\s*)(rm|rmdir|unlink|shred)\b/.test(c)) return { category: "fs_delete" };
  if (/\bfind\b[\s\S]*-delete\b/.test(c)) return { category: "fs_delete" };
  if (/(^|[;&|]\s*)git\s+clean\b/.test(c)) return { category: "fs_delete" };

  // インストール（外部から取得して追加）
  if (/(^|[;&|]\s*)(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b/.test(c)) return { category: "install" };
  if (/(^|[;&|]\s*)(pip|pip3|pipx)\s+install\b/.test(c)) return { category: "install" };
  if (/(^|[;&|]\s*)(gem|cargo|go|brew|apt|apt-get|dnf|yum|pacman|choco|winget)\s+(install|add|get)\b/.test(c))
    return { category: "install" };

  // 外部通信（ネットワーク送受信）
  const host = extractHost(c);
  if (/(^|[;&|]\s*)(curl|wget|http|nc|ncat|telnet|scp|sftp|rsync|ssh)\b/.test(c)) return { category: "egress", host };
  if (host) return { category: "egress", host };

  // 公開（外部の共有場所へアップロード）
  if (/(^|[;&|]\s*)git\s+push\b/.test(c)) return { category: "publish" };
  if (/\bgh\s+(pr|issue|release|gist)\s+(create|comment|edit)\b/.test(c)) return { category: "publish" };
  if (/(^|[;&|]\s*)(npm|pnpm|yarn)\s+publish\b/.test(c)) return { category: "publish" };
  if (/\bdocker\s+push\b/.test(c)) return { category: "publish" };
  if (/\bgh\s+api\b[\s\S]*--method\s+(POST|PATCH|PUT|DELETE)\b/i.test(c)) return { category: "publish" };

  // 変更履歴の書換
  if (/(^|[;&|]\s*)git\s+(reset|rebase|merge|revert|commit|tag)\b/.test(c)) return { category: "vcs_history" };

  // ファイル書換・作成
  // リダイレクト（>/>>）。ただし 2>&1 や >/dev/null は実体書込でないので除外。
  if (/(^|[^0-9&])>>?\s*(?!\/dev\/null)[^\s|&;]+/.test(c)) return { category: "fs_write" };
  if (/(^|[;&|]\s*)(tee|dd|cp|mv|mkdir|touch|ln|truncate)\b/.test(c)) return { category: "fs_write" };
  if (/\bsed\b[^|;&]*-i\b/.test(c)) return { category: "fs_write" };

  return null;
}

// 型 → 平易テンプレート（host があれば差し込む）
function categoryTemplate(category, host) {
  switch (category) {
    case "egress":
      if (isLocalHost(host)) return `お使いのパソコン内で動いているプログラム（${host}）に接続して、データをやり取りします。`;
      if (host) return `インターネット上のサービス（${host}）に接続して、データを取得または送信します。心当たりのない送信先でないか確認してください。`;
      return `インターネットや別のコンピュータに接続して、データを取得または送信します。送信先に心当たりがあるか確認してください。`;
    case "fs_delete":
      return `パソコン内のファイルやフォルダを削除します。元に戻せない場合があるため注意してください。`;
    case "install":
      return `ソフトやライブラリを外部から取得して追加インストールします。`;
    case "publish":
      return `インターネット上の共有の場所へ、内容を公開・アップロードします。`;
    case "vcs_history":
      return `変更履歴を書き換えます（保存・巻き戻し・統合など）。`;
    case "fs_write":
      return `パソコン内のファイルを新しく作成、または書き換えます。`;
    case "privilege":
      return `パソコンの設定や権限を変更する、影響の大きい操作です。内容をよく確認してください。`;
    default:
      return null;
  }
}

// ============================================================================
// 段 3: LLM フォールバック（型は判明したが具体文が無い未知コマンド）
// ============================================================================
function cacheFilePath() {
  return path.join(beltaDir(), "cache", "explain.json");
}

// キャッシュキー：コマンドの「動詞」部分（先頭の非フラグ 2 トークン）。
// 引数や値で散らばらせず、同種コマンドで説明を使い回す。
function cacheKey(cmd) {
  const toks = String(cmd).trim().split(/\s+/);
  const verb = [];
  for (const t of toks) {
    if (t.startsWith("-")) break;
    verb.push(t.toLowerCase());
    if (verb.length >= 2) break;
  }
  return verb.join(" ") || String(cmd).trim().slice(0, 40).toLowerCase();
}

function readCache() {
  try {
    const obj = JSON.parse(fs.readFileSync(cacheFilePath(), "utf8"));
    if (obj && obj.entries && typeof obj.entries === "object") return obj;
  } catch {
    /* fall through */
  }
  return { version: 1, entries: {}, cooldownUntil: 0 };
}

function writeCache(obj) {
  try {
    const entries = obj.entries || {};
    // 肥大化防止：500 件を超えたら古い順に間引く。
    const keys = Object.keys(entries);
    if (keys.length > 500) {
      keys
        .sort((a, b) => (entries[a].ts || 0) - (entries[b].ts || 0))
        .slice(0, keys.length - 500)
        .forEach((k) => delete entries[k]);
    }
    const dir = path.dirname(cacheFilePath());
    fs.mkdirSync(dir, { recursive: true });
    // atomic 書き（同一ディレクトリの一時ファイル → rename）
    const tmp = path.join(dir, `.explain.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries, cooldownUntil: obj.cooldownUntil || 0 }, null, 0));
    fs.renameSync(tmp, cacheFilePath());
  } catch {
    /* fail-open: キャッシュ書込失敗は無視 */
  }
}

// claude -p を MCP/ツール無効・haiku で同期実行し、1 文を得る。失敗時 null。
function callClaude(cmd) {
  const sys =
    "あなたはシェルコマンドを非エンジニアに説明する翻訳者です。" +
    "渡されたコマンドが実際には何をするかを、専門用語を避けた日本語で1文（40字以内）で述べてください。" +
    "コマンドの是非・許可可否は述べず、何をするかだけ。ツールは一切使わないこと。";
  try {
    const out = execFileSync(
      "claude",
      [
        "-p",
        cmd,
        "--output-format",
        "text",
        // light ティア（skills/workflow/references/model-tiers.md）。**エイリアスで指定する**：
        // バージョン付き ID を直書きすると同系列の世代交代に追従しなくなる。
        "--model",
        "haiku",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--allowed-tools",
        "",
        "--append-system-prompt",
        sys,
      ],
      {
        input: "",
        timeout: 4000,
        killSignal: "SIGKILL",
        maxBuffer: 256 * 1024,
        encoding: "utf8",
        // 子の stderr は捨てる（claude の警告等がフックの出力やターミナルへ漏れないように）
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, [SUBPROCESS_GUARD]: "1" },
      }
    );
    const line = String(out || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || "";
    if (!line) return null;
    return line.length > 80 ? line.slice(0, 79) + "…" : line;
  } catch {
    return null;
  }
}

// LLM 呼び出しが失敗したら一定時間スキップするサーキットブレーカーの停止時間。
// 認証が効かない環境（例: デスクトップアプリ経由で OAuth を引き継げず 401）でも、
// 型のみコマンドのたびに毎回タイムアウト待ちする事故を防ぐ（30 分に 1 回まで試行）。
const LLM_COOLDOWN_MS = 30 * 60 * 1000;

// 型判明・辞書ミスの未知 Bash コマンドに対し、キャッシュ→LLM の順で具体文を得る。
// config で無効・子プロセス内・クールダウン中・失敗時はいずれも null（呼び出し側が
// 型テンプレへフォールバック）。
function llmExplainBash(cmd, now) {
  if (process.env[SUBPROCESS_GUARD] === "1") return null;
  if (!readConfigBool("explain_llm_fallback", true)) return null;

  const t = Number(now) || Date.now();
  const cache = readCache();

  const key = cacheKey(cmd);
  const hit = cache.entries[key];
  if (hit && hit.plain) return hit.plain; // 成功キャッシュは常に優先

  // サーキットブレーカー：直近に失敗していればしばらく試さない（遅延の連発を防ぐ）。
  if (cache.cooldownUntil && t < cache.cooldownUntil) return null;

  const plain = callClaude(cmd);
  if (!plain) {
    // 失敗 → クールダウン開始（次回以降は即 null＝型テンプレへ、遅延なし）
    cache.cooldownUntil = t + LLM_COOLDOWN_MS;
    writeCache(cache);
    return null;
  }
  cache.entries[key] = { plain, ts: t };
  cache.cooldownUntil = 0; // 成功したらクールダウン解除
  writeCache(cache);
  return plain;
}

// ============================================================================
// 公開 API: やさしい説明の本文（plain）を組み立てる
// ============================================================================
// 戻り値: { plain, tech } か null（説明対象外＝呼び出し側で素通し）。
//   opts.allowLLM=false で LLM フォールバックを抑止（テスト・明示無効化）。
function explainPlain(toolName, toolInput, opts) {
  const allowLLM = !opts || opts.allowLLM !== false;

  // Bash
  if (/(^|_)Bash$/.test(toolName) || toolName === "Bash") {
    const cmd = String((toolInput && toolInput.command) || "");
    const tech = techSummary(cmd);

    const known = dictBash(cmd);
    if (known) return { plain: known, tech };

    const cls = classifyBash(cmd);
    if (!cls) return null; // 純読み取り・判定不能 → 素通し

    if (allowLLM) {
      const llm = llmExplainBash(cmd);
      if (llm) return { plain: llm, tech };
    }
    return { plain: categoryTemplate(cls.category, cls.host), tech };
  }

  // MCP（claude.ai Connector）書き込み系
  const mcp = dictMcp(toolName);
  if (mcp) return { plain: mcp, tech: toolName.replace(/^mcp__[^_]+__/, "") };

  // Edit / Write：エージェント自身のルールファイルを書き換えようとしたときだけ警告する
  const cfg = dictConfigWrite(toolName, toolInput);
  if (cfg) return cfg;

  return null;
}

// エージェントの「守りの設定」そのものを書き換える操作の説明。
// 業務上どうしても必要な場面があるため禁止（deny）にはせず、
// 何が起きるのかを平易に伝えて利用者に判断してもらう（settings.json の ask ルールと対）。
function dictConfigWrite(toolName, toolInput) {
  if (!/(^|_)(Edit|Write|MultiEdit|NotebookEdit)$/.test(String(toolName))) return null;
  const p = String((toolInput && (toolInput.file_path || toolInput.notebook_path)) || "");
  if (!p) return null;
  const norm = p.replace(/\\/g, "/");

  if (/\/\.claude\/settings(\.local)?\.json$/.test(norm)) {
    return {
      plain:
        "このエージェントの「やってよい操作／確認が必要な操作／禁止する操作」を決めている設定ファイルそのものを書き換えます。\n" +
        "変更すると、これまで自動で止まっていた操作（機密の外部送信や削除など）が止まらなくなることがあります。\n" +
        "設定を見直す作業を自分で頼んだ場合だけ許可し、心当たりがなければ拒否してください。",
      tech: `${toolName} → ${p}`,
    };
  }
  if (/\/\.claude\/(hooks|skill-policy)[^/]*$/.test(norm) || /\/hooks\/hooks\.json$/.test(norm)) {
    return {
      plain:
        "自動で働く見張り役（フック）や、使ってよいスキルの許可リストの設定を書き換えます。\n" +
        "変更すると、機密の検知や未許可スキルの確認が働かなくなることがあります。心当たりがなければ拒否してください。",
      tech: `${toolName} → ${p}`,
    };
  }
  return null;
}

function techSummary(text) {
  const one = String(text).replace(/\s+/g, " ").trim();
  return one.length > 200 ? one.slice(0, 197) + "…" : one;
}

// 許可ダイアログに出す reason 全文を組み立てる。対象外なら null。
function buildAskReason(toolName, toolInput, opts) {
  const ex = explainPlain(toolName, toolInput, opts);
  if (!ex) return null;
  return (
    `この操作を実行しようとしています。許可してよいか確認してください。\n\n` +
    `🟢 かんたんな説明:\n${ex.plain}\n\n` +
    `🔧 実際の操作:\n${ex.tech}\n\n` +
    `心当たりがある操作なら「許可」、意図しない送信・書き込みが含まれるなら「拒否」を選んでください。`
  );
}

module.exports = {
  SUBPROCESS_GUARD,
  buildAskReason,
  explainPlain,
  classifyBash,
  dictBash,
  dictMcp,
  dictConfigWrite,
  categoryTemplate,
  cacheKey,
  readConfigBool,
};
