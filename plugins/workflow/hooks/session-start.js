#!/usr/bin/env node
//
// Belta workflow plugin — 初回セットアップ自動起動 + グローバル誤有効化の警告（SessionStart）
//
// このフックは SessionStart で発火し、2 つの追加コンテキストを必要に応じて注入する。
//
//   (A) 初回オンボーディング誘導:
//       Claude Code には「インストール時フック」が無いため、インストール後最初の
//       セッションでオンボーディング未完了（~/.belta/.onboarded が無い）なら、
//       エージェントへ「/workflow-setup を開始せよ」という案内を注入する。
//
//   (B) グローバル誤有効化の警告網（footgun セーフティネット）:
//       本プラグインは「ホーム直下の専用フォルダ限定（ローカルスコープ）でだけ発火」を
//       既定運用とする。ところが /plugin install の CLI 既定は User スコープ（全ディレクトリ）。
//       不慣れな利用者がグローバル有効化してしまうと、業務と無関係なあらゆるセッションで
//       ワークフローの作法が発火してしまう。そこでユーザースコープ
//       （~/.claude/settings.json の enabledPlugins）に本プラグインが有効化されていれば、
//       「ローカル限定運用を推奨」と警告し /workflow-setup での付け替えを促す。
//       ※ あくまで警告のみ。利用者の settings.json を勝手に書き換えない（自動解除はしない）。
//
// Mac / Windows 両対応のためシェル非依存の Node.js で実装する。ホーム解決は環境変数、
// パス連結は path.join、JSON エスケープは JSON.stringify に委ねる。
// フックの鉄則: 例外時は決してセッションを妨げない（無出力で exit 0 / fail-open）。

const fs = require("fs");
const os = require("os");
const path = require("path");

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// このプラグインの名前（enabledPlugins キー "<name>@<marketplace>" の <name>）。
function pluginName() {
  const root = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, "..");
  const manifest = readJson(path.join(root, ".claude-plugin", "plugin.json"));
  return (manifest && manifest.name) || "workflow";
}

// 指定 settings にこのプラグインが有効化されているか（enabledPlugins に "<name>@*": true）。
function pluginEnabledIn(settingsPath, name) {
  const s = readJson(settingsPath);
  if (!s || !s.enabledPlugins) return false;
  return Object.entries(s.enabledPlugins).some(([k, v]) => v === true && k.startsWith(name + "@"));
}

const contexts = [];

try {
  const home = homeDir();

  // (A) オンボーディング未完了なら案内を注入。
  const onboarded = fs.existsSync(path.join(home, ".belta", ".onboarded"));
  if (!onboarded) {
    contexts.push(
      [
        "【Belta ワークフローエージェント 初回セットアップ】",
        "",
        "この環境ではまだ初回セットアップ（~/.belta/.onboarded）が完了していません。ユーザーへの応答の冒頭で、これからセットアップを行う旨を一言伝えたうえで、/workflow-setup コマンドの手順（plugins/workflow/commands/workflow-setup.md）に従い、初回オンボーディングを開始してください。",
        "",
        "このプラグインは『ホーム直下の専用フォルダ（~/my-agent）限定（ローカルスコープ）でだけ使う』運用です。/workflow-setup が専用フォルダを作成し、そのフォルダでだけ有効化します。セットアップ後は Claude Code をそのフォルダで開き直して使うよう案内してください。",
        "",
        "収集する項目: 氏名 / 部署 / 主要業務（3つまで） / 扱う情報の機密度（公開・社外秘・極秘） / 接続する MCP ツール（Notion・Slack・Google Drive・GitHub）。",
        "",
        "メールアドレスは userEmail コンテキスト（system-bot@belta.co.jp 等）を初期値として確認し、必要なら訂正してもらってください。収集後 ~/.belta/profile.md を生成し、4 ツールの OAuth 接続を案内し、完了したら ~/.belta/.onboarded を作成してください。",
        "",
        "ただしユーザーが別の用件を明確に依頼している場合は、その用件を優先し、セットアップは後回しでよい旨を伝えてください（セットアップは次回起動時に再度案内されます）。",
      ].join("\n")
    );
  }

  // (B) ユーザースコープ（グローバル）で有効化されていたら警告を注入。
  const userSettings = path.join(home, ".claude", "settings.json");
  if (pluginEnabledIn(userSettings, pluginName())) {
    contexts.push(
      [
        "【注意: このプラグインがグローバル（ユーザースコープ）で有効化されています】",
        "",
        "本プラグインは『ホーム直下の専用フォルダ（~/my-agent）限定（ローカルスコープ）でだけ使う』運用を推奨しています。ところが現在、ユーザー設定（~/.claude/settings.json の enabledPlugins）でグローバルに有効化されており、業務と無関係なものを含む全セッションでワークフローの作法（オンボーディング誘導・分岐スキル・PII フック）が発火してしまう状態です。",
        "",
        "ユーザーへの応答の冒頭で、この点を一言知らせ、ローカル限定運用に切り替えることを推奨してください。切り替えは /workflow-setup を実行すると専用フォルダ ~/my-agent をローカルスコープで用意できます。あわせて、グローバル有効化を解除したい場合は /plugin メニュー、または ~/.claude/settings.json の enabledPlugins から本プラグインのエントリを外すよう案内してください（このフックは設定を勝手に書き換えません）。",
        "",
        "ユーザーが意図的にグローバル運用している場合は、その意思を尊重して構いません。",
      ].join("\n")
    );
  }

  // (C) セッションまたぎの反復検知: 直近の notes を走査し、同じ趣旨の依頼が
  //     別々のセッションで 2 回以上あれば、パーソナライズ提案を促す指示を注入する。
  //     検知は決定的（正規化一致）。意味判断と提案は LLM に委ねる。
  try {
    const { normalizeRequest, parseNotesSessions } = require(path.join(__dirname, "repeat-util.js"));
    const notesDir = path.join(home, ".belta", "notes");
    const names = fs.readdirSync(notesDir).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n));
    // 直近 7 暦日分のみ走査（agent-learning の「5 営業日」窓を週末込みで覆う）。
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const keyMap = new Map(); // 正規化キー -> { sessions:Set<sessionId>, sample:生テキスト }
    for (const name of names) {
      const m = /^(\d{4})-(\d{2})-(\d{2})\.md$/.exec(name);
      const fileMs = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
      if (Number.isFinite(fileMs) && fileMs < cutoff) continue;
      let text = "";
      try {
        text = fs.readFileSync(path.join(notesDir, name), "utf8");
      } catch {
        continue;
      }
      for (const row of parseNotesSessions(text)) {
        const seenInRow = new Set(); // 同一セッション行内の重複は 1 機会に畳む（またぎ検知のため）
        for (const raw of row.requests) {
          const k = normalizeRequest(raw);
          if (!k || seenInRow.has(k)) continue;
          seenInRow.add(k);
          if (!keyMap.has(k)) keyMap.set(k, { sessions: new Set(), sample: raw });
          keyMap.get(k).sessions.add(row.sessionId);
        }
      }
    }
    const repeated = [...keyMap.values()]
      .filter((v) => v.sessions.size >= 2)
      .sort((a, b) => b.sessions.size - a.sessions.size)
      .slice(0, 3);
    if (repeated.length) {
      const lines = repeated.map(
        (v) => `・「${String(v.sample).slice(0, 60)}」（別々のセッションで ${v.sessions.size} 回）`
      );
      contexts.push(
        [
          "【Belta パーソナライズ検知（セッションまたぎの反復）】",
          "",
          "直近の記録（~/.belta/notes/）で、同じ趣旨の依頼が別々のセッションで繰り返されています:",
          ...lines,
          "",
          "本セッションでこれらの作業に着手する際は、agent-learning の消去法ゲートに従い、その領域を専用エージェント化するか（テキストで足りれば rule-learning、既製スキルで足りれば skill-suggestion、専門手順なら skill-authoring）を AskUserQuestion で提案するか検討してください。1 つの依頼の言い直し・継続は反復に数えません。既に AGENTS.md / RULES.md / SKILLS.md / AUTHORED.md で採用済み・却下・冷却中の領域は対象外です。",
        ].join("\n")
      );
    }
  } catch {
    /* notes 無し・読めない等は黙って素通り（fail-open） */
  }
} catch {
  // fail-open: 何が起きてもセッションを妨げない。
  process.exit(0);
}

if (contexts.length === 0) {
  process.exit(0);
}

const output = {
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: contexts.join("\n\n---\n\n"),
  },
};

process.stdout.write(JSON.stringify(output) + "\n");
process.exit(0);
