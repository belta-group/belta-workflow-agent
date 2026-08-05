#!/usr/bin/env node
//
// BELTA workflow plugin — 設定変更の監査記録（ConfigChange）
//
// セッション中に設定ファイル（settings.json / settings.local.json / 管理設定 / スキル）が
// 変更された事実を監査ログへ 1 行残す。公式ドキュメントがチームセキュリティとして
// 「ConfigChange hooks でセッション中の設定変更を監査またはブロック」を推奨しているため、
// その監査側を担う。
//
// 🔴 このフックは決してブロックしない（exit 0 のみ）。理由:
//    守りの設定を書き換える操作は既に pre-tool-use.js の役割 2（dictConfigWrite）が
//    「ask」＝利用者確認に載せている。ここで重ねて block すると、業務上必要な設定変更
//    （MCP 実名の付け替え、apply-governance.js の適用そのもの）まで止めてしまう。
//    ここは「後から追える記録」に徹し、可否判断は ask と利用者に委ねる。
//
// 記録するのは判定メタだけ（変更ソース種別 / 設定ファイル名 / セッション）。
// 設定の中身・差分は書かない（audit-log.js と同じ原則。監査が機密の複製にならないため）。
// config_path は basename だけを残す（フルパスは利用者名などを含みうるため）。
//
// 例外時は無出力で exit 0（fail-open。監査の失敗でセッションを止めない）。

const path = require("path");

let recordSecurityEvent;
try {
  ({ recordSecurityEvent } = require("./audit-log.js"));
} catch {
  process.exit(0); // ユーティリティが読めない環境では黙って何もしない
}

// ConfigChange の source（公式の matcher 値）。想定外の値もそのまま記録する。
const KNOWN_SOURCES = new Set([
  "user_settings",
  "project_settings",
  "local_settings",
  "policy_settings",
  "skills",
]);

function readStdin() {
  try {
    const fs = require("fs");
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

try {
  const raw = readStdin();
  if (!raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // 壊れた入力は無視（fail-open）
  }
  if (!payload || typeof payload !== "object") process.exit(0);

  const source = typeof payload.source === "string" ? payload.source : "";
  const configPath = typeof payload.config_path === "string" ? payload.config_path : "";

  // ソースも対象パスも取れないなら記録する意味がない（判定不能は素通し）。
  if (!source && !configPath) process.exit(0);

  const labels = [];
  if (source) labels.push(KNOWN_SOURCES.has(source) ? source : "unknown_source");
  // 管理設定の変更はブロック不可（公式仕様）＝検知の重みが違うので明示ラベルを足す。
  if (source === "policy_settings") labels.push("managed_policy");

  recordSecurityEvent({
    decision: "allow", // 記録のみ。ここでは何も止めていないことを明示する
    hook: "config-change",
    rule: "config-change",
    labels,
    // フルパスは避け、ファイル名だけ（どの設定が触られたかは判別でき、パスは漏れない）
    subject: configPath ? path.basename(configPath) : undefined,
    session: payload.session_id,
  });
} catch {
  /* fail-open */
}

process.exit(0);
