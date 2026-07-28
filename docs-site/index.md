---
layout: home

hero:
  name: LAVS
  text: Local Agent View Service
  tagline: 让本地 Agent 把结构化数据以可交互 UI 呈现，并与对话侧双向同步。CLI 优先，任何 Agent 即用。
  actions:
    - theme: brand
      text: 快速上手
      link: /guide/quick-start
    - theme: alt
      text: CLI 还是 MCP？
      link: /guide/cli-vs-mcp

features:
  - title: CLI 优先
    details: 任何 Agent 都能用 lavs call 直接操作数据，stdout 输出干净 JSON 可管道。无需 MCP，无需绑定特定客户端。
  - title: 自动刷新的 View
    details: lavs view 起一个本地 host，浏览器里呈现交互式 UI；Agent 每次 mutation 后，view 经 SSE 自动刷新。
  - title: 协议化 Bundle
    details: 一份 lavs.json 清单声明 query/mutation/subscription 端点 + view 组件。Bundle 按 content-type 标识，跨 Agent / 场景复用。
  - title: 后台常驻
    details: lavs daemon 一键注册为系统服务（macOS launchd / Linux systemd），开机自启、崩溃重启。
  - title: Handler 丰富
    details: script / function / http / mcp 四种 handler 覆盖本地脚本、进程内函数、HTTP 代理、MCP 桥接。
  - title: 双向桥接 MCP
    details: lavs serve 把端点暴露为 MCP 工具（lavs_xxx）；mcp handler 反向把外部 MCP 工具接为 LAVS 端点。
---
