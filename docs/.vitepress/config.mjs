import { defineConfig } from 'vitepress'

// GitHub Pages の公開パス（https://<org>.github.io/belta-workflow-agent/）に合わせる。
// ローカルプレビュー時もこの base で配信される。
const base = '/belta-workflow-agent/'

export default defineConfig({
  lang: 'ja-JP',
  title: 'BELTA ワークフローエージェント',
  description:
    'BELTA 社内向けワークフロー自動化エージェント（Claude Code Plugin）の利用ガイド。導入・OAuth 接続・使い方・セキュリティをまとめています。',
  base,

  // docs/ をルートにしているため、利用者向けでない内部ドキュメント（背景・実装チェックリスト）と
  // リポジトリ README はビルド対象から除外する。社外秘情報の誤公開を防ぐ。
  // タスクメモは tasks.md から tasks/ ディレクトリへ移したので、配下もまとめて除外する。
  srcExclude: ['background.md', 'tasks.md', 'tasks/**', 'README.md'],

  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: 'localhostLinks',

  head: [
    ['meta', { name: 'robots', content: 'noindex, nofollow' }],
    // ファビコン（ブラウザのタブに出る小さなロゴ）。head は base を自動付与しないため明示する。
    ['link', { rel: 'icon', type: 'image/png', href: `${base}logo.png` }]
  ],

  themeConfig: {
    // ナビゲーションバー左上のロゴ（base はテーマ側が自動付与するため先頭 / 始まりでよい）。
    logo: '/logo.png',

    // ページ内全文検索。VitePress 同梱のローカル検索（MiniSearch）を使う。
    // 外部サービス・追加依存なしでビルド時にインデックスを生成するため、
    // Mac / Windows どちらの環境でも同じように動作する（社外秘情報も外部へ出ない）。
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '検索',
            buttonAriaLabel: '検索'
          },
          modal: {
            displayDetails: '詳細を表示',
            resetButtonTitle: '検索条件をリセット',
            backButtonTitle: '検索を閉じる',
            noResultsText: '見つかりませんでした：',
            footer: {
              selectText: '選択',
              selectKeyAriaLabel: 'enter',
              navigateText: '移動',
              navigateUpKeyAriaLabel: '上矢印',
              navigateDownKeyAriaLabel: '下矢印',
              closeText: '閉じる',
              closeKeyAriaLabel: 'esc'
            }
          }
        }
      }
    },

    nav: [
      { text: 'ホーム', link: '/' },
      { text: '利用ガイド', link: '/guide/getting-started' },
      { text: '育成アバター', link: '/avatar' },
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
            { text: 'コマンド一覧', link: '/guide/commands' },
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
