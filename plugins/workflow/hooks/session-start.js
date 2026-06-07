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

// "a.b.c" 形式のセマンティックバージョン比較。数値フィールドを順に比較し、数値化できない
// 要素や桁数差は安全側（0 扱い）で処理する。a>b で 1、a<b で -1、等しければ 0。
function compareVersions(a, b) {
  const pa = String(a).split(".");
  const pb = String(b).split(".");
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = parseInt(pa[i], 10) || 0;
    const y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// 直近に通知したバージョンを atomic に保存（次セッションで同一バージョンなら無出力にするため）。
// 書けなくても通知判定は次回へ持ち越すだけ（fail-open）。
function writeVersionState(p, version) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ version, updated_at: new Date().toISOString() }) + "\n");
    fs.renameSync(tmp, p);
  } catch {
    /* fail-open */
  }
}

const contexts = []; // LLM へ渡す追加文脈（additionalContext。利用者画面には出ない）
const systemMessages = []; // 利用者に直接見せるメッセージ（systemMessage。LLM 任せにしない）

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

  // (D) セッションまたぎの事実誤り（ハルシネーション）反復検知:
  //     repeat-detect.js が各セッションの状態ファイル（audit/repeat/<session>.json）へ
  //     記録した訂正イベントを横断集計し、同じ趣旨の訂正が別々のセッションで 2 回以上
  //     あれば、事実訂正メモリ（hallucination-memory）への記録を促す。
  try {
    const repeatDir = path.join(home, ".belta", "audit", "repeat");
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 直近 7 日分のみ
    const corrMap = new Map(); // 訂正キー -> { sessions:Set<file>, sample }
    for (const name of fs.readdirSync(repeatDir)) {
      if (!name.endsWith(".json")) continue;
      const p = path.join(repeatDir, name);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) continue;
      } catch {
        continue;
      }
      let j;
      try {
        j = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        continue;
      }
      if (!j || !Array.isArray(j.corrections)) continue;
      const seenInSession = new Set(); // 同一セッション内の重複は 1 機会に畳む（またぎ検知のため）
      for (const c of j.corrections) {
        if (!c || typeof c.key !== "string" || !c.key) continue;
        if (seenInSession.has(c.key)) continue;
        seenInSession.add(c.key);
        if (!corrMap.has(c.key)) corrMap.set(c.key, { sessions: new Set(), sample: c.sample || c.key });
        corrMap.get(c.key).sessions.add(name);
      }
    }
    const repeatedCorr = [...corrMap.values()]
      .filter((v) => v.sessions.size >= 2)
      .sort((a, b) => b.sessions.size - a.sessions.size)
      .slice(0, 3);
    if (repeatedCorr.length) {
      const lines = repeatedCorr.map(
        (v) => `・「${String(v.sample).slice(0, 60)}」（別々のセッションで ${v.sessions.size} 回 指摘）`
      );
      contexts.push(
        [
          "【Belta 事実訂正メモリ検知（セッションまたぎのハルシネーション再発）】",
          "",
          "過去の記録で、同じ趣旨の事実誤りの指摘（訂正）が別々のセッションで繰り返されています:",
          ...lines,
          "",
          "これらは、あなた（または過去のセッションのエージェント）が同じ事実を繰り返し間違えている可能性を示します。本セッションで関連する話題に触れる際は、~/.belta/memory/MEMORY.md（あれば）を必ず確認し、訂正済みの正しい事実を踏まえて応答してください。",
          "まだ記録されていない再発があれば、hallucination-memory スキルに従って『正しい事実』を ~/.belta/memory/ に記録するか AskUserQuestion で提案してください（二度と同じ誤りを犯さないため）。好み・書式の指摘は対象外（それは rule-learning）。既に記録済み・却下・冷却中のものは対象外です。",
        ].join("\n")
      );
    }
  } catch {
    /* audit/repeat 無し・読めない等は黙って素通り（fail-open） */
  }

  // (E) プラグイン更新通知:
  //     同梱マニフェストの version を ~/.belta/plugin-version.json の前回値と比較し、
  //     変化していれば「更新されました」案内を 1 回だけ通知する。Claude Code 画面右下の
  //     注意バッジ（"N MCP servers need auth" 等）は組み込み専用スロットで外部から書けない
  //     ための代替。利用者には top-level systemMessage で**直接**表示し（LLM 任せにしない）、
  //     あわせて additionalContext で LLM にも文脈を渡す（再実行の促し等）。additionalContext
  //     だけだと最初の操作が slash command のとき応答に現れず取りこぼすため systemMessage を正とする。
  //     初回（記録が無い）は基準値を黙って保存するだけ＝誤って「更新」と出さない。通知後は
  //     記録を現行バージョンへ更新するので、同一バージョンの次セッション以降は無出力。
  try {
    const root = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, "..");
    const manifest = readJson(path.join(root, ".claude-plugin", "plugin.json"));
    const current = manifest && typeof manifest.version === "string" ? manifest.version.trim() : "";
    if (current) {
      const stateFile = path.join(home, ".belta", "plugin-version.json");
      const prev = readJson(stateFile);
      const prevVer = prev && typeof prev.version === "string" ? prev.version.trim() : "";
      if (!prevVer) {
        // 記録が無い初回・既存利用者の本機能導入直後は、基準値の保存のみ（更新通知は出さない）。
        writeVersionState(stateFile, current);
      } else if (prevVer !== current) {
        const upgraded = compareVersions(current, prevVer) > 0;
        const headline = upgraded
          ? `Belta ワークフローエージェントが v${prevVer} → v${current} に更新されました。`
          : `Belta ワークフローエージェントのバージョンが変わりました（v${prevVer} → v${current}）。`;
        // (1) 利用者へ確実に表示する：top-level systemMessage（LLM 任せにしない）。
        //     additionalContext は LLM にしか渡らず、最初の操作が slash command だと
        //     応答に現れないことがある（実機で取りこぼしを確認）。人間向けの通知は
        //     systemMessage を正とする。
        systemMessages.push(
          `🔔 ${headline} 生成済みダッシュボード（~/.belta/dashboard.html）等は再生成まで古いままです。/avatar や /report を再実行すると最新が反映されます。`
        );
        // (2) LLM にも文脈として渡す（応答に自然に一言添える・再実行を促す補助）。
        contexts.push(
          [
            "【Belta ワークフローエージェント 更新通知】",
            "",
            headline,
            "",
            "この更新は利用者にも systemMessage で表示済みです。ユーザーへの応答に一言添えて構いません。生成済みの成果物（例: 育成アバターダッシュボード ~/.belta/dashboard.html）は再生成するまで古いままなので、必要なら対応するコマンド（/avatar や /report など）を再実行すると最新の内容・体裁が反映される旨も添えてください。変更点の詳細は README / docs を参照するよう案内して構いません。",
            "",
            "ユーザーが別の用件を依頼している場合は、その用件を優先する。",
          ].join("\n")
        );
        // 通知は 1 回限り。記録を現行バージョンへ更新する（次回は同一なので無出力）。
        writeVersionState(stateFile, current);
      }
    }
  } catch {
    /* マニフェスト読めない・書けない等は黙って素通り（fail-open） */
  }
} catch {
  // fail-open: 何が起きてもセッションを妨げない。
  process.exit(0);
}

if (contexts.length === 0 && systemMessages.length === 0) {
  process.exit(0);
}

const output = { hookSpecificOutput: { hookEventName: "SessionStart" } };
if (contexts.length > 0) {
  // LLM へ渡す追加文脈（利用者画面には出ない）。
  output.hookSpecificOutput.additionalContext = contexts.join("\n\n---\n\n");
}
if (systemMessages.length > 0) {
  // 利用者へ直接表示（LLM には渡らない）。確実に見せたい通知はこちら。
  output.systemMessage = systemMessages.join("\n");
}

process.stdout.write(JSON.stringify(output) + "\n");
process.exit(0);
