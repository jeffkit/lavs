# 快速上手

3 分钟内让 LAVS 跑起来，在浏览器里看到你的第一个可交互 view。

## 前置条件

- Node.js 20+
- 一个终端

## 1. 获取 LAVS

LAVS 还没发到 npm，目前从源码运行：

```bash
git clone https://github.com/jeffkit/lavs.git
cd lavs
pnpm install
pnpm -r build
```

## 2. 发现官方 bundle

LAVS 自带一个 `todo-list` bundle 作为示例：

```bash
node sdk/typescript/runtime/dist/cli.js discover --registry-dir ./bundles
```

输出：

```
Found 1 bundle(s):

  📦 todo-list  (lavs/todo-list)
     Interactive todo list with AI assistance
     endpoints: listTodos, addTodo, toggleTodo, deleteTodo, clearDone
```

## 3. 打开 view

```bash
node sdk/typescript/runtime/dist/cli.js view --registry-dir ./bundles
```

浏览器会自动打开 `http://localhost:7842`，左侧是 bundle 列表，右侧是 todo-list 的交互界面。

## 4. 用 CLI 操作数据

另开一个终端：

```bash
# 加一条 todo
node sdk/typescript/runtime/dist/cli.js call addTodo \
  --agent-dir ./bundles/todo-list \
  --input '{"text":"学会 LAVS","priority":1}'

# 查看列表
node sdk/typescript/runtime/dist/cli.js call listTodos \
  --agent-dir ./bundles/todo-list --quiet
```

**关键体验**：执行 `addTodo` 后，**浏览器的 view 会自动刷新**——不需要手动刷新页面。这是 LAVS 的核心：Agent 改了数据，view 实时同步。

## 5. 让 Agent 接管

LAVS 的真正价值在于让 AI Agent 操作数据。两种方式：

- **CLI**：任何能跑 shell 命令的 Agent，用 `lavs call` 即可。详见 [CLI 还是 MCP？](./cli-vs-mcp)
- **MCP**：Claude Code / Cursor 等 MCP 客户端，用 `lavs serve-registry` 把 bundle 暴露成工具。

## 下一步

- [CLI 命令手册](./cli) —— 所有命令和选项
- [后台常驻](./daemon) —— 让 view 开机自启
- [写自己的 bundle](../reference/manifest) —— lavs.json 字段参考
