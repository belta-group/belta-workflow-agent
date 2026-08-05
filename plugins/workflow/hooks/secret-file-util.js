#!/usr/bin/env node
//
// BELTA workflow plugin — 機密ファイル参照の検知（pre-tool-use.js 役割 3 の判定エンジン）
//
// 目的: `.env` / SSH 秘密鍵 / `*.pem` / クラウド認証情報 を読み出そうとする操作を、
//       コマンドの種類に依存せず検知する。
//
// なぜコマンド列挙に頼らないか:
//   permissions の `Read(...)` deny は Claude Code が認識するファイルコマンド
//   （cat / head / tail / sed）までは効くが、awk / xxd / source / od / リダイレクト /
//   自作スクリプト経由の読み出しには届かない。「読める道具」を列挙し続ける戦いは
//   必ず負けるので、ここでは **コマンドではなく「参照されているファイル」** を見る。
//
// 誤遮断（false positive）対策:
//   - `.env.example` 等のテンプレート系サフィックスは素通し（機密を含まない規約ファイル）。
//   - 正規表現リテラル（`"\.env"` のようにエスケープや文字クラスを含むトークン）は
//     「ファイルパスではなく検索パターン」と見なして素通し。
//     → `grep -rn "\.env" docs/` のような正当な調査を止めない。
//   - 追加の例外は ~/.belta/config.yaml の env_guard_exceptions（カンマ区切り）で足せる。
//
// クロスプラットフォーム: 区切り文字は `/` `\` 両対応。パス直書き・シェル依存なし。

// テンプレート系（機密を含まない）サフィックス。完全一致で末尾判定する。
const EXEMPT_SUFFIXES = [
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.dist",
  ".env.defaults",
  ".env.test.example",
];

// トークン抽出: シェルの区切り・引用符で分割した「パスらしい断片」を拾う。
const TOKEN_SPLIT_RE = /[\s"'`;|&<>()={},]+/;

// 検知パターン（label は監査ログと利用者向け説明の両方に使う分類名）。
const PATTERNS = [
  {
    label: "環境変数ファイル（.env）",
    // `.env` / `.env.local` / `secrets.env` / glob（`*.env` `.env.*`）を拾う。
    // 拡張子の後にさらに語が続く（`.environment` 等）ものは除外する。
    test: (t) => /(^|[/\\])\.env(\.[\w*?-]+|\*)*$/.test(t) || /(^|[/\\])[\w.*?-]+\.env$/.test(t),
  },
  {
    label: "SSH 秘密鍵ディレクトリ（.ssh）",
    test: (t) => /(^|[/\\])\.ssh([/\\]|$)/.test(t),
  },
  {
    label: "SSH 秘密鍵ファイル（id_rsa / id_ed25519 等）",
    test: (t) => /(^|[/\\])id_(rsa|dsa|ecdsa|ed25519)(\.\w+)?$/.test(t),
  },
  {
    label: "証明書・秘密鍵（.pem / .key / .p12）",
    test: (t) => /\.(pem|p12|pfx)$/.test(t) || /(^|[/\\])[\w.-]+\.key$/.test(t),
  },
  {
    label: "クラウド認証情報（.aws / .gcloud / gh の設定）",
    test: (t) =>
      /(^|[/\\])\.aws([/\\]|$)/.test(t) ||
      /(^|[/\\])\.config[/\\]gcloud([/\\]|$)/.test(t) ||
      /(^|[/\\])\.config[/\\]gh([/\\]|$)/.test(t),
  },
];

// 正規表現リテラルらしいトークン（＝ファイルパスではない）か。
// バックスラッシュのエスケープ・文字クラス・アンカーを含むものは検索パターン扱い。
function looksLikeRegexLiteral(token) {
  return /\\|[[\]^$]/.test(token);
}

function normalizeToken(token) {
  let t = token.trim();
  // 先頭の代入・フラグ（`FOO=./.env` / `--file=.env`）を落とす
  const eq = t.lastIndexOf("=");
  if (eq >= 0) t = t.slice(eq + 1);
  // 末尾の記号を落とす
  t = t.replace(/[),;:]+$/, "");
  return t;
}

function isExempt(token, extraExempt) {
  const lower = token.toLowerCase();
  for (const suf of EXEMPT_SUFFIXES) {
    if (lower.endsWith(suf)) return true;
  }
  for (const suf of extraExempt) {
    if (suf && lower.endsWith(suf.toLowerCase())) return true;
  }
  return false;
}

/**
 * テキスト（Bash コマンド文字列・ファイルパス・glob）から機密ファイル参照を探す。
 *
 * @param {string} text
 * @param {string[]} [extraExempt] 追加の例外サフィックス（config.yaml env_guard_exceptions）
 * @returns {string[]} 検出した分類ラベル（重複なし）。無ければ空配列。
 */
function findSecretFileRefs(text, extraExempt = []) {
  const hits = new Set();
  if (!text) return [];

  for (const rawToken of String(text).split(TOKEN_SPLIT_RE)) {
    if (!rawToken) continue;
    if (looksLikeRegexLiteral(rawToken)) continue;

    const token = normalizeToken(rawToken);
    if (!token) continue;
    if (isExempt(token, extraExempt)) continue;

    for (const p of PATTERNS) {
      if (p.test(token)) hits.add(p.label);
    }
  }

  return Array.from(hits);
}

module.exports = { findSecretFileRefs, EXEMPT_SUFFIXES };
