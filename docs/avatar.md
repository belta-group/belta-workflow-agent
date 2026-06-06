---
title: 育成アバター
---

# 🎮 育成アバター

<script setup>
import { ref, onMounted, computed } from 'vue'
import { withBase } from 'vitepress'

// バッジ id → 表示名・絵文字（公開 JSON は id だけ。名前はこの静的辞書で人間化する）
const BADGE_CATALOG = {
  'first-steps': { name: 'はじめの一歩', emoji: '👣' },
  'streak-7': { name: '一週間皆勤', emoji: '🔥' },
  'streak-30': { name: '月間皆勤', emoji: '🌟' },
  'diligent': { name: '勤勉', emoji: '📅' },
  'rule-collector': { name: 'ルール蒐集家', emoji: '📚' },
  'mistake-mender': { name: '同じ轍を踏まず', emoji: '🩹' },
  'automator': { name: '自動化の達人', emoji: '🤖' },
  'first-hire': { name: 'はじめての雇用', emoji: '🧑‍💼' },
  'artisan': { name: '技を授かる', emoji: '🛠️' },
  'polyglot': { name: '四刀流', emoji: '🗡️' },
  'cache-master': { name: 'キャッシュ番長', emoji: '⚡' },
  'token-titan': { name: '大量稼働', emoji: '🏋️' },
  'knowledge-keeper': { name: '物覚えの達人', emoji: '🧠' },
  'well-understood': { name: 'あうんの呼吸', emoji: '🤝' },
  'early-bird': { name: '朝型', emoji: '🌅' },
  'night-owl': { name: '夜型', emoji: '🦉' }
}
const STAGE = ['🥚 たまご', '🐣 かけだし', '🧒 一人前', '🧑 熟練', '🧙 達人', '👑 賢者']
const AXES = [
  ['stamina', '継続'], ['wisdom', '知識'], ['power', '自動化'],
  ['agility', '効率'], ['versatility', '多才'], ['discipline', '規律']
]
const TOOLS = [['notion', 'Notion'], ['slack', 'Slack'], ['github', 'GitHub'], ['drive', 'Drive']]

const data = ref(null)
const err = ref('')

onMounted(async () => {
  try {
    const res = await fetch(withBase('/avatar-stats.json'), { cache: 'no-cache' })
    data.value = await res.json()
  } catch (e) {
    err.value = '読み込めませんでした'
  }
})

const xpPct = computed(() => {
  if (!data.value) return 0
  return Math.max(0, Math.min(100, Math.round((data.value.xp_into_level / Math.max(1, data.value.xp_for_next)) * 100)))
})
const badgeName = (id) => (BADGE_CATALOG[id] ? `${BADGE_CATALOG[id].emoji} ${BADGE_CATALOG[id].name}` : id)
</script>

<div v-if="err" class="av-note">{{ err }}（まだ公開データがありません）</div>

<div v-else-if="data" class="av">
  <div class="av-hero">
    <div class="av-stage">{{ STAGE[data.stage_index] || STAGE[0] }}</div>
    <div class="av-lv">Lv.{{ data.level }}</div>
    <div class="av-sub">連続稼働 {{ data.streak.current }} 日（最長 {{ data.streak.max }}）／ 稼働 {{ data.counts.active_days }} 日</div>
    <div class="av-bar"><div class="av-fill" :style="{ width: xpPct + '%' }"></div></div>
    <div class="av-sub">XP {{ data.xp }}（このレベル {{ data.xp_into_level }} / {{ data.xp_for_next }}）</div>
  </div>

  <h2>ステータス</h2>
  <div class="av-stats">
    <div v-for="[k, label] in AXES" :key="k" class="av-stat">
      <div class="av-stat-h"><span>{{ label }}</span><span>{{ data.stats[k] }}</span></div>
      <div class="av-bar sm"><div class="av-fill" :style="{ width: data.stats[k] + '%' }"></div></div>
    </div>
  </div>

  <h2>スキルツリー</h2>
  <div class="av-tools">
    <div v-for="[k, label] in TOOLS" :key="k" class="av-tool">
      <div class="av-tool-n">{{ label }}</div>
      <div class="av-tool-s">{{ data.skill_tree[k].stage }}</div>
      <div class="av-tool-h">{{ data.skill_tree[k].hits }} 回</div>
    </div>
  </div>

  <h2>実績バッジ（{{ data.badges_earned.length }}/{{ data.badges_total }}）</h2>
  <div class="av-badges">
    <span v-for="b in data.badges_earned" :key="b.id" class="av-badge" :data-tier="b.tier">{{ badgeName(b.id) }}</span>
  </div>

  <p class="av-note">最終更新: {{ data.generated_date }} ／ このページは匿名化された数値のみを表示します（依頼内容・個人情報・名前・画像は含みません）。</p>
</div>

<div v-else class="av-note">読み込み中…</div>

<style scoped>
.av-hero { background: var(--vp-c-bg-soft); border-radius: 16px; padding: 24px; text-align: center; margin: 16px 0; }
.av-stage { font-size: 28px; }
.av-lv { font-size: 40px; font-weight: 800; color: var(--vp-c-brand-1); }
.av-sub { color: var(--vp-c-text-2); font-size: 14px; margin: 4px 0; }
.av-bar { height: 14px; background: var(--vp-c-bg-mute); border-radius: 8px; overflow: hidden; margin: 8px auto; max-width: 420px; }
.av-bar.sm { height: 10px; margin: 4px 0; }
.av-fill { height: 100%; background: linear-gradient(90deg, var(--vp-c-brand-1), var(--vp-c-brand-2)); }
.av-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px 24px; }
.av-stat-h { display: flex; justify-content: space-between; font-size: 14px; }
.av-tools { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.av-tool { background: var(--vp-c-bg-soft); border-radius: 12px; padding: 14px; text-align: center; }
.av-tool-n { font-weight: 700; }
.av-tool-s { color: var(--vp-c-text-2); font-size: 13px; margin: 4px 0; }
.av-tool-h { color: var(--vp-c-text-3); font-size: 12px; }
.av-badges { display: flex; flex-wrap: wrap; gap: 10px; }
.av-badge { background: var(--vp-c-bg-soft); border-radius: 20px; padding: 6px 14px; font-size: 14px; border: 1px solid var(--vp-c-divider); }
.av-badge[data-tier="gold"] { border-color: #e0b400; }
.av-badge[data-tier="silver"] { border-color: #9aa3c7; }
.av-note { color: var(--vp-c-text-3); font-size: 13px; }
@media (max-width: 640px) { .av-tools { grid-template-columns: repeat(2, 1fr); } .av-stats { grid-template-columns: 1fr; } }
</style>

::: info これはデモ表示です
ここに表示されているのはサンプルの匿名データ（`docs/public/avatar-stats.json`）です。あなた自身のアバターは、お使いのパソコン内で `/avatar` を実行すると `~/.belta/dashboard.html`（POSIX: `$HOME` / Windows: `%USERPROFILE%`）に生成されます。GitHub Pages へ公開したい場合のみ `/avatar --publish` で、依頼内容・個人情報を除いた**数値だけ**をここに反映できます。
:::
