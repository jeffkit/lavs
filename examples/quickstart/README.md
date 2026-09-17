# LAVS Quickstart — 从零到「Agent 操控页面」5 分钟

> 在另一台电脑上从零体验：打开一个真实浏览器页面，用命令行扮演 Agent，
> 看页面实时响应数据变更（mutation）和纯 UI 命令（notify / SPEC §12）。

## 0. 前置

- Node.js ≥ 20、pnpm ≥ 9（`npm i -g pnpm`）
- 本仓尚未发布到 npm，所以第一步是 clone 源码。

## 1. Clone + 构建（一次性）

```bash
git clone git@github.com:jeffkit/lavs.git
cd lavs
pnpm install
pnpm build            # 构建 types → runtime → client → view
pnpm test             # 可选：全量测试
```

## 2. 打开视图宿主（扮演"页面"）

```bash
node sdk/typescript/runtime/dist/cli.js view --registry-dir examples/quickstart
```

会自动打开浏览器标签页，左侧是 bundle 列表（这里只有一个 `demo`），
右侧是它的视图：暗色背景、空的列表。

## 3. 扮演"Agent"（另开一个终端）

```bash
alias lavs='node sdk/typescript/runtime/dist/cli.js call'

# 查询（query）
lavs getItems --agent-dir examples/quickstart/demo
# → []

# 变更（mutation）—— 注意看浏览器：页面自动刷新出 "Hello LAVS"
lavs addItem --agent-dir examples/quickstart/demo --input '{"text":"Hello LAVS"}'

# UI 命令（notify，SPEC §12）—— 注意看浏览器：页面切换成亮色主题
lavs setTheme --agent-dir examples/quickstart/demo --input '{"theme":"light"}'

# 再切回暗色
lavs setTheme --agent-dir examples/quickstart/demo --input '{"theme":"dark"}'
```

也可以用 MCP 方式：`node sdk/typescript/runtime/dist/cli.js serve --agent-dir examples/quickstart/demo`
会把 `getItems` / `addItem` / `setTheme` 暴露成 MCP 工具 `lavs_*`，接入任意 MCP 宿主。

## 4. 这个 demo 里有什么

```
demo/
├── lavs.json          # 3 个 endpoint：getItems(query) / addItem(mutation) / setTheme(notify)
├── scripts/           # handler 实现（普通 Node 脚本，stdin/args 进 stdout JSON 出）
├── data/items.json    # 数据落在 bundle 自己的 data/ 目录
└── view/index.html    # 单文件视图 + lavs-view.iife.js（@lavs/view 预编译产物）
```

要点：

- **notify endpoint 不需要 handler** —— 纯 UI 命令没有服务端副作用，runtime
  直接把 `command + args` 广播给视图（`action.type: "ui_command"`）。
- **视图侧用 `@lavs/view`**：`LAVSView.connect({ refresh, commands })` 一个调用
  完成桥接、刷新回退和命令注册。认识的命令本地处理，不认识的自动回退刷新。
- 把 `examples/quickstart/demo` 复制一份改名，就是你的第一个自己的 bundle。

## 5. 下一步

- 协议全貌：`docs/SPEC.md`（§5 通信、§11 dispatch、§12 UI Command）
- 官方参考 bundle：`bundles/todo-list`（CRUD + `setFilter` / `setCompact`）
- 编写自己的 bundle：docs-site → Guide → Create a bundle
