# プロフィール雛形（profile.md）

オンボーディング（`/workflow-setup`）で収集した利用者情報を `~/.belta/profile.md` に保存する際の**テンプレートとフィールド定義**。運営モードでは毎セッションの冒頭にこのファイルを読み込み、部署・機密度・主要業務を文脈に入れる。

> `~/.belta/` は `.gitignore` で除外済み。個人データはリポジトリに commit しない。機械可読な設定値は別途 `~/.belta/config.yaml`（`scripts/belta-init.js` が管理）に持つ。profile.md は人間可読の正本。

---

## テンプレート

```markdown
---
owner_name: <氏名>
owner_email: <メール>
department: <部署>
confidentiality: <公開|社外秘|極秘>
created_at: <YYYY-MM-DD>
---

## 主要業務
- <業務1>
- <業務2>
- <業務3>

## 接続ツール
- <選択したツール一覧>
```

---

## フィールド定義

| フィールド | 必須 | 説明 | 使われ方 |
| --- | --- | --- | --- |
| `owner_name` | ○ | 氏名 | 応答の宛名・記録の署名 |
| `owner_email` | ○ | メール（`userEmail` を初期値に確認）。複数ユーザー識別の主キー | `config.yaml` の `owner_email` と一致させる。記録の所有者 |
| `department` | ○ | 所属部署 | [roles.md](roles.md) の該当ロールを引き当て、プライマリロール `~/.belta/roles/<slug>.md` に展開し索引 `roles/ROLES.md` に記録する |
| `confidentiality` | ○ | 公開 / 社外秘 / 極秘 | PII 検知フックの警告文脈・外部送信前確認の厳格度（[security-policies.md](security-policies.md) §2） |
| `created_at` | ○ | 作成日（YYYY-MM-DD） | プロフィール鮮度の参照 |
| 主要業務 | ○ | 3 つまで | 発話 → ツール分岐の優先度、自動エージェント化（agent-learning）の領域判定 |
| 接続ツール | ○ | 選択した MCP ツール一覧 | どのツールを案内・利用するかの基準 |

---

## 関連

- 収集手順: [`commands/workflow-setup.md`](../../../commands/workflow-setup.md) Step 1–2
- 部署ロール定義: [roles.md](roles.md)
- 機械可読設定の初期化・管理: `scripts/belta-init.js`（`~/.belta/config.yaml`）
- 運営モードでの読み込み: [`SKILL.md`](../SKILL.md)
