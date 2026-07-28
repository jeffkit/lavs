import { defineConfig } from 'vitepress';

// GitHub Pages 项目站点部署在 /lavs/ 子路径下，本地 dev 用 /。
// 设 BASE 环境变量可覆盖（例如自定义域名时用 BASE=/）。
const base = process.env.BASE ?? (process.env.GITHUB_ACTIONS ? '/lavs/' : '/');

export default defineConfig({
  base,
  title: 'LAVS',
  description: 'Local Agent View Service — 让本地 Agent 把结构化数据以可交互 UI 呈现，并与对话侧双向同步',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['meta', { name: 'theme-color', content: '#7c3aed' }],
  ],

  themeConfig: {
    siteTitle: 'LAVS',

    logo: '/logo.svg',

    nav: [
      { text: '指南', link: '/guide/quick-start' },
      { text: '协议', link: '/spec/overview' },
      { text: '参考', link: '/reference/manifest' },
      { text: 'GitHub', link: 'https://github.com/jeffkit/lavs' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始',
          items: [
            { text: '快速上手', link: '/guide/quick-start' },
            { text: 'CLI 命令', link: '/guide/cli' },
            { text: 'CLI 还是 MCP？', link: '/guide/cli-vs-mcp' },
            { text: '后台常驻（Daemon）', link: '/guide/daemon' },
          ],
        },
      ],
      '/spec/': [
        {
          text: '协议规范',
          items: [
            { text: '总览', link: '/spec/overview' },
            { text: 'View Dispatch (v1.1)', link: '/spec/v1.1-dispatch' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '参考',
          items: [
            { text: 'Manifest 字段', link: '/reference/manifest' },
            { text: '实现状态', link: '/reference/status' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/jeffkit/lavs' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 jeffkit',
    },

    outline: {
      level: [2, 3],
      label: '本页内容',
    },

    docFooter: {
      prev: '上一页',
      next: '下一页',
    },

    lastUpdatedText: '最后更新',
  },
});
