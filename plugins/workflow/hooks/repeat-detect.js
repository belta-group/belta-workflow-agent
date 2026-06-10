#!/usr/bin/env node
//
// Belta workflow plugin — 同一セッション内の反復検知（UserPromptSubmit）
//
// 2 種類の反復を「同一セッション内」で決定的に検知し、追加コンテキストを注入する:
//   (1) 同じ趣旨の依頼が 2 回以上 → パーソナライズ提案（agent-learning ほか）を促す。
//   (2) 事実誤り（ハルシネーション）の指摘が 2 回以上 → 事実訂正メモリ
//       （hallucination-memory）への記録を促し、二度と同じ誤りを犯さないようにする。
// あわせて (3) 直近 5 時間のトークン消費（token-usage.js の記録）がしきい値
//   （config.yaml の token_5h_warn）を超えていたら、セッション途中でも一度だけ
//   省トークンを促す警告を注入する（SessionStart 警告だけでは長いセッション内の
//   消費急増を拾えないため。5 時間に 1 回までのクールダウン付き）。
// 検知は決定的（正規化した文字列の一致 / 訂正マーカー）で行い、意味判断と実際の提案は
// LLM に委ねる（本当にハルシネーションか・同じ誤りの再発かは LLM が確定する）。
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
  const { normalizeRequest, looksLikeCorrection } = require(path.join(__dirname, "repeat-util.js"));

  const payload = JSON.parse(readStdin() || "{}");
  const prompt = String(payload.prompt || "");
  const sessionId = String(payload.session_id || "").trim();
  if (!sessionId) process.exit(0); // セッション不明

  const home = resolveHome();
  if (!home) process.exit(0);

  const key = normalizeRequest(prompt); // 依頼の反復検知用キー（比較に不適なら ""）
  const isCorrection = looksLikeCorrection(prompt); // 事実誤り（ハルシネーション）の指摘か

  const dir = path.join(home, ".belta", "audit", "repeat");
  fs.mkdirSync(dir, { recursive: true });
  const tag = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  const file = path.join(dir, `${tag}.json`);

  // 既存状態を読む（壊れていれば初期化）。keys=依頼の反復、corrections=訂正イベント、
  // token_warned_at=トークン消費警告を最後に出した時刻（クールダウン用）。
  let keys = [];
  let corrections = [];
  let tokenWarnedAt = 0;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j && Array.isArray(j.keys)) keys = j.keys.filter((k) => typeof k === "string");
    if (j && Array.isArray(j.corrections)) {
      corrections = j.corrections.filter((c) => c && typeof c.key === "string");
    }
    if (j && Number.isFinite(Number(j.token_warned_at))) tokenWarnedAt = Number(j.token_warned_at);
  } catch {
    /* 無ければ新規 */
  }

  // (3) 直近 5 時間のトークン消費チェック（依頼内容に関係なく毎送信みる。クールダウン付き）。
  //     token-usage.js は Stop 時にしか書かないため値は 1 応答分遅れる（近似で十分）。
  let tokenWarnBlock = "";
  try {
    const { sumRecentLimitEquiv, readTokenWarnThreshold, FIVE_HOURS_MS } = require(path.join(__dirname, "tokens-util.js"));
    const threshold = readTokenWarnThreshold(path.join(home, ".belta"));
    const now = Date.now();
    if (threshold > 0 && now - tokenWarnedAt > FIVE_HOURS_MS) {
      const recent = sumRecentLimitEquiv(path.join(home, ".belta", "audit", "tokens"), FIVE_HOURS_MS, now);
      if (recent >= threshold) {
        tokenWarnedAt = now; // クールダウン開始（下の atomic write で永続化）
        const fmt = (n) => Number(n).toLocaleString("en-US");
        tokenWarnBlock = [
          "【Belta トークン消費警告（直近5時間）】",
          "",
          `token-usage 記録上、直近 5 時間の利用制限カウント相当の消費が推計 ${fmt(recent)} トークンに達しています（警告しきい値 ${fmt(threshold)}。~/.belta/config.yaml の token_5h_warn で変更、0 で無効）。Claude の利用制限（5 時間ローリング窓）に近づいている可能性があります。`,
          "",
          "今回の依頼への応答の冒頭で、この旨を利用者へ一言知らせてください（消費の内訳は /usage で見られることも添える）。そのうえで省トークンの作法を意識してください: 大きなファイルの全文 Read を避ける・同じ調査を繰り返さない・大規模走査の前に対象を絞る。",
        ].join("\n");
      }
    }
  } catch {
    /* tokens-util 不在・記録なし等は黙って素通り（fail-open） */
  }

  if (!key && !isCorrection && !tokenWarnBlock) process.exit(0); // どの検知対象でもない

  // 今回の送信を 1 件だけ追記（1 送信 = 1 件。二重計上しない）。
  if (key) {
    keys.push(key);
    if (keys.length > MAX_KEYS) keys = keys.slice(-MAX_KEYS);
  }
  // 訂正イベントも 1 送信 1 件で追記。短い訂正で key が空でも比較できるようフォールバックキーを使う。
  let correctionKey = "";
  if (isCorrection) {
    correctionKey = key || prompt.replace(/\s+/g, "").toLowerCase().slice(0, 80);
    const sample = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
    corrections.push({ key: correctionKey, sample });
    if (corrections.length > MAX_KEYS) corrections = corrections.slice(-MAX_KEYS);
  }

  // atomic write。
  try {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ keys, corrections, token_warned_at: tokenWarnedAt }), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    /* 書けなくても検知は続行（下のカウントは在メモリの値を使う） */
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

  const blocks = [];
  if (tokenWarnBlock) blocks.push(tokenWarnBlock);

  // (1) 依頼の反復（既存）: 同一キーが 2 回以上 → パーソナライズ提案。
  if (key) {
    const total = keys.filter((k) => k === key).length;
    if (total >= 2) {
      const req = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
      blocks.push(
        [
          "【Belta パーソナライズ検知（同一セッション内の反復）】",
          "",
          `利用者はこのセッションで同じ趣旨の依頼「${req}」を ${total} 回出しています（同じ作業を反復させている可能性が高い）。`,
          "この依頼を処理する前後で、agent-learning / rule-learning / skill-suggestion / skill-authoring の消去法ゲートに従い、専用エージェント化・自動ルール化などのパーソナライズを AskUserQuestion で提案するか判断してください。あわせて、この依頼が既存の部署ロール（~/.belta/roles/）でカバーされない部署領域なら新しいロールの追加を、既存ロールの領域なら典型業務・成果物の型のブラッシュアップを提案するか検討してください（workflow スキルの references/roles.md「ロールの提案と成長」）。",
          "ただし 1 つの依頼を達成する過程での言い直し・追加指示・絞り込みは反復に数えません（独立した再依頼のときだけ提案）。既に AGENTS.md / RULES.md / SKILLS.md / AUTHORED.md / ROLES.md で採用済み・却下・冷却中の領域は対象外です。",
        ].join("\n")
      );
    }
  }

  // (2) 事実誤り（ハルシネーション）の指摘の反復: このセッションで訂正が 2 回以上 →
  //     事実訂正メモリ（hallucination-memory）への記録を促す。同一の訂正キーが
  //     2 回以上なら「同じ誤りの再発」を明示して、より強く記録を促す。
  if (isCorrection && corrections.length >= 2) {
    const sameKeyCount = corrections.filter((c) => c.key === correctionKey).length;
    const corr = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
    const recurrence =
      sameKeyCount >= 2
        ? `今回と同じ趣旨の訂正がこのセッションで ${sameKeyCount} 回出ています（同じ事実誤りを繰り返している可能性が高い）。`
        : `このセッションで事実誤りの指摘が ${corrections.length} 回出ています（直近の指摘:「${corr}」）。`;
    blocks.push(
      [
        "【Belta 事実訂正メモリ検知（ハルシネーション再発の可能性）】",
        "",
        recurrence,
        "まず ~/.belta/memory/MEMORY.md（あれば）と直前までの会話を確認し、あなたが同じ事実誤り（ハルシネーション）を 2 回以上犯していないか確かめてください。",
        "同じ誤りの再発だと確認できたら、hallucination-memory スキルに従い、訂正された『正しい事実』を ~/.belta/memory/ に記録するか AskUserQuestion で提案してください（二度と同じ誤りを犯さないため）。",
        "1 回限りの言い間違い・利用者自身のミスの訂正・好み（書式や口調）の指摘は対象外です（好みは rule-learning へ）。事実そのものの誤りだけを記録対象にします。",
      ].join("\n")
    );
  }

  if (!blocks.length) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: blocks.join("\n\n---\n\n"),
      },
    }) + "\n"
  );
} catch {
  // fail-open: 何が起きてもプロンプトを妨げない。
}
process.exit(0);
