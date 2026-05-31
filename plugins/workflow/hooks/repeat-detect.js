#!/usr/bin/env node
//
// Belta workflow plugin — 同一セッション内の反復検知（UserPromptSubmit）
//
// 利用者が同じ趣旨の依頼を「同一セッション内」で 2 回以上出したとき、パーソナライズ
// 提案（agent-learning ほか）を促す追加コンテキストを注入する。検知は決定的（正規化
// した依頼文の一致）で行い、意味判断と実際の提案は LLM に委ねる。
//
// なぜフックか:
//   パーソナライズの起動は本来 workflow / agent-learning スキルに委ねるが、直接の依頼では
//   スキルが能動的に提案へ進まないことがある（取りこぼし）。notes 記録を Stop フックで
//   確定化したのと同じ思想で、検知・起動側にも決定的な下支えを置く。
//
// カウント方法（トランスクリプト非依存）:
//   UserPromptSubmit 時点でトランスクリプトが現在のプロンプトを含むかは実装依存で曖昧。
//   そこで本フック自身が、セッションごとの小さな状態ファイル
//   （<home>/.belta/audit/repeat/<session>.json）に毎回 1 件だけ正規化キーを追記し、
//   そのセッション内で同一キーが 2 回以上になったら注入する。1 送信 = 1 追記なので
//   二重計上しない（Stop の notes upsert と同じ確定化の発想）。
//
// 設計（cross-platform.md 準拠）:
//   - シェル非依存の Node.js。ホームは環境変数、パスは path.join、書き込みは atomic。
//   - フックの鉄則: プロンプトを決してブロックしない。例外時も無出力で exit 0（fail-open）。
//
// 入力: stdin に UserPromptSubmit の JSON（prompt / session_id / transcript_path / cwd）。
// 出力: 反復検知時のみ hookSpecificOutput.additionalContext を JSON で返す。それ以外は無出力。

const fs = require("fs");
const path = require("path");
const os = require("os");

const STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // セッション状態ファイルの保持（7 日）
const MAX_KEYS = 300; // 1 セッションで保持する依頼キーの上限

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function resolveHome() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}

try {
  const { normalizeRequest } = require(path.join(__dirname, "repeat-util.js"));

  const payload = JSON.parse(readStdin() || "{}");
  const prompt = String(payload.prompt || "");
  const sessionId = String(payload.session_id || "").trim();

  const key = normalizeRequest(prompt);
  if (!key || !sessionId) process.exit(0); // 比較に不適 or セッション不明

  const home = resolveHome();
  if (!home) process.exit(0);

  const dir = path.join(home, ".belta", "audit", "repeat");
  fs.mkdirSync(dir, { recursive: true });
  const tag = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  const file = path.join(dir, `${tag}.json`);

  // 既存状態を読む（壊れていれば初期化）。
  let keys = [];
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j && Array.isArray(j.keys)) keys = j.keys.filter((k) => typeof k === "string");
  } catch {
    /* 無ければ新規 */
  }

  // 今回の送信を 1 件だけ追記（1 送信 = 1 件。二重計上しない）。
  keys.push(key);
  if (keys.length > MAX_KEYS) keys = keys.slice(-MAX_KEYS);

  // atomic write。
  try {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ keys }), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    /* 書けなくても検知は続行（下のカウントは在メモリの keys を使う） */
  }

  // 古いセッション状態を掃除（保持期間超過）。
  try {
    const cutoff = Date.now() - STATE_RETENTION_MS;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
      } catch {
        /* 個別失敗は無視 */
      }
    }
  } catch {
    /* 掃除失敗は致命でない */
  }

  const total = keys.filter((k) => k === key).length;
  if (total < 2) process.exit(0); // 初回 → 何もしない（2 回目以降のみ）

  const req = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
  const ctx = [
    "【Belta パーソナライズ検知（同一セッション内の反復）】",
    "",
    `利用者はこのセッションで同じ趣旨の依頼「${req}」を ${total} 回出しています（同じ作業を反復させている可能性が高い）。`,
    "この依頼を処理する前後で、agent-learning / rule-learning / skill-suggestion / skill-authoring の消去法ゲートに従い、専用エージェント化・自動ルール化などのパーソナライズを AskUserQuestion で提案するか判断してください。",
    "ただし 1 つの依頼を達成する過程での言い直し・追加指示・絞り込みは反復に数えません（独立した再依頼のときだけ提案）。既に AGENTS.md / RULES.md / SKILLS.md / AUTHORED.md で採用済み・却下・冷却中の領域は対象外です。",
  ].join("\n");

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx },
    }) + "\n"
  );
} catch {
  // fail-open: 何が起きてもプロンプトを妨げない。
}
process.exit(0);
