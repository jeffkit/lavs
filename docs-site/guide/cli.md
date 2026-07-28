# CLI 命令

`lavs-runtime` 是 LAVS 的统一入口。9 个子命令覆盖发现、调用、可视化、常驻、桥接全流程。

```bash
npx lavs-runtime <command> [options]
# 或源码运行：
node sdk/typescript/runtime/dist/cli.js <command> [options]
```

## 命令总览

| 命令 | 作用 | 需要常驻？ |
|---|---|---|
| [`discover`](#discover) | 列出目录下的所有 bundle | 否 |
| [`call`](#call) | 直接调用一个端点 | 否 |
| [`view`](#view) | 启动 host + 打开浏览器 view | 是（前台） |
| [`host`](#host) | 启动全局 host（多目录聚合） | 是（前台） |
| [`daemon`](#daemon) | 管理 host 系统服务 | 是（后台） |
| [`init`](#init) | 脚手架生成最小 lavs.json | 否 |
| [`validate`](#validate) | 校验 lavs.json | 否 |
| [`serve`](#serve) | 把单个 bundle 暴露为 MCP server | 是（stdio） |
| [`serve-registry`](#serve-registry) | 把多 bundle 聚合为一个 MCP server | 是（stdio） |

## discover

扫描目录，列出所有 LAVS bundle 及其端点。

```bash
lavs discover [--registry-dir <path>]...
```

```bash
lavs discover --registry-dir ./bundles
lavs discover --registry-dir ./bundles --registry-dir ./more-bundles
```

支持两种目录布局：
- **单 bundle**：`registry-dir/lavs.json`（registry 目录本身就是一个 bundle）
- **多 bundle**：`registry-dir/<bundle-name>/lavs.json`（registry 下每个子目录一个 bundle）

## call

直接调用端点。stdout 输出干净 JSON，可管道。mutation 后自动通知运行中的 host。

```bash
lavs call <endpoint> --agent-dir <path> [--input '<json>'] [--quiet]
```

```bash
# Query（读）
lavs call listTodos --agent-dir ./bundles/todo-list

# Mutation（写）—— view 自动刷新
lavs call addTodo --agent-dir ./bundles/todo-list \
  --input '{"text":"买牛奶","priority":1}'

# 管道
lavs call listTodos --agent-dir ./bundles/todo-list --quiet \
  | jq '.[] | select(.done == false)'

# 用自定义端口的 host
LAVS_HOST_PORT=9000 lavs call addTodo --agent-dir ./bundles/todo-list \
  --input '{"text":"通知到 9000"}'
```

| 选项 | 说明 |
|---|---|
| `--agent-dir <path>` | bundle 目录（含 lavs.json）。默认 cwd |
| `--input '<json>'` | 端点输入参数，JSON 字符串。默认 `{}` |
| `--quiet` | 抑制 stderr 诊断日志（`[LAVS]` 追踪），stdout 保持纯 JSON |

::: tip 通知端口
`lavs call` 执行 mutation 后会通知 host 刷新 view。默认通知到 7842 端口；
若 host 跑在别的端口，设 `LAVS_HOST_PORT=<port>` 环境变量。
:::

## view

启动 host 服务器 + 打开浏览器，呈现交互式 view。前台运行，Ctrl+C 退出。

```bash
lavs view [contentType] [--registry-dir <path>] [--port <n>] [--no-open]
```

```bash
# 打开目录下所有 bundle
lavs view --registry-dir ./bundles

# 直接打开特定 bundle
lavs view todo-list --registry-dir ./bundles

# 自定义端口
lavs view --registry-dir ./bundles --port 8080

# 不自动开浏览器
lavs view --registry-dir ./bundles --no-open
```

## host

与 `view` 类似，但设计为全局聚合 host——可挂载多个 registry 目录。
MCP server 和 `lavs call` 默认通知到这个 host（7842 端口）。

```bash
lavs host [--registry-dir <path>]... [--port <n>]
```

```bash
lavs host --registry-dir ~/work-bundles --registry-dir ~/home-bundles
```

运行中可通过 host UI 的侧边栏动态增删 registry 目录。

## daemon

把 host 注册为系统后台服务：开机自启、崩溃自动重启。

```bash
lavs daemon install   [--registry-dir <path>]... [--port <n>]
lavs daemon uninstall
lavs daemon status
```

详见 [后台常驻](./daemon)。

## init

在目标目录脚手架生成一个最小的 `lavs.json`，作为写自己 bundle 的起点。

```bash
lavs init --agent-dir ./my-bundle
```

## validate

加载并校验 `lavs.json`（含 JSON Schema 校验、路径解析检查、相邻 `mcp-config.json` 检查）。

```bash
lavs validate --agent-dir ./my-bundle
```

## serve

启动一个 MCP server（stdio 传输），把**单个** bundle 的端点暴露为 MCP 工具 `lavs_<endpoint>`。

```bash
lavs serve --agent-dir ./bundles/todo-list [--agent-id todo-list]
```

适合：只需一个 bundle、或给单个 bundle 做精细的 agent-id 隔离。

## serve-registry

启动一个 MCP server，把**多个** registry 目录的所有 bundle 聚合暴露。Agent 用 `lavs_discover` 自主探索，用 `lavs_call` 调用。

```bash
lavs serve-registry --registry-dir ./bundles [--registry-dir ./more]
```

适合：Claude Code / Cursor 集成，让 Agent 一次看到所有 bundle。详见 [CLI 还是 MCP？](./cli-vs-mcp)。

## 全局选项

| 选项 | 适用命令 | 说明 |
|---|---|---|
| `--quiet` | 所有 | 设 `LAVS_QUIET=1`，抑制 `[LAVS]` 诊断日志 |
