import { defineConfig } from 'vitepress'

// GitHub Pages の公開パス（https://<org>.github.io/belta-workflow-agent/）に合わせる。
// ローカルプレビュー時もこの base で配信される。
const base = '/belta-workflow-agent/'

export default defineConfig({
  lang: 'ja-JP',
  title: 'Belta ワークフローエージェント',
  description:
    'Belta 社内向けワークフロー自動化エージェント（Claude Code Plugin）の利用ガイド。導入・OAuth 接続・使い方・セキュリティをまとめています。',
  base,

  // docs/ をルートにしているため、利用者向けでない内部ドキュメント（背景・実装チェックリスト）と
  // リポジトリ README はビルド対象から除外する。社外秘情報の誤公開を防ぐ。
  srcExclude: ['background.md', 'tasks.md', 'README.md'],

  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: 'localhostLinks',

  head: [['meta', { name: 'robots', content: 'noindex, nofollow' }]],

  themeConfig: {
    nav: [
      { text: 'ホーム', link: '/' },
      { text: '利用ガイド', link: '/guide/getting-started' },
      { text: 'FAQ', link: '/guide/faq' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'はじめに',
          items: [
            { text: '概要', link: '/guide/' },
            { text: '導入手順（5 分セットアップ）', link: '/guide/getting-started' },
            { text: '4 ツール OAuth 接続', link: '/guide/oauth-setup' }
          ]
        },
        {
          text: '使い方',
          items: [
            { text: '基本的な使い方', link: '/guide/usage' },
            { text: 'パーソナライズ機能', link: '/guide/personalization' }
          ]
        },
        {
          text: '運用',
          items: [
            { text: 'セキュリティと権限', link: '/guide/security' },
            { text: 'トラブルシューティング / FAQ', link: '/guide/faq' }
          ]
        }
      ]
    },

    docFooter: {
      prev: '前へ',
      next: '次へ'
    },

    outline: {
      label: 'このページの内容',
      level: [2, 3]
    },

    lastUpdatedText: '最終更新',
    returnToTopLabel: '上へ戻る',
    sidebarMenuLabel: 'メニュー',
    darkModeSwitchLabel: '配色',
    lightModeSwitchTitle: 'ライトモードに切り替え',
    darkModeSwitchTitle: 'ダークモードに切り替え',

    docFooterText: '社内利用限定（UNLICENSED）',

    socialLinks: [
      { icon: 'github', link: 'https://github.com/belta-group/belta-workflow-agent' }
    ]
  }
})
