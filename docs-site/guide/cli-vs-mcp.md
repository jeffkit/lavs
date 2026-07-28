# CLI 还是 MCP？

LAVS 提供两条对外接口：**CLI**（`lavs call`）和 **MCP server**（`lavs serve`）。
两者操作的是同一份 bundle 数据，但适用场景不同。本文帮你选对路径。

## 一句话选择

| 你的 Agent 环境 | 推荐 |
|---|---|
| Claude Code / Cursor / 任何 MCP 客户端 | **MCP** —— 工具自动出现在 Agent 工具列表 |
| ZCode、Aider、其他 CLI Agent，或脚本 | **CLI** —— 用 `lavs call` 直接操作 |
| 想让 view 自动刷新 | **两者都行** —— mutation 后 host 都会收到通知 |
| 一次性脚本 / CI | **CLI** —— 无需常驻进程 |

## 两条路径的对比

### CLI 路径（`lavs call`）

```bash
# Agent 直接调命令，stdout 拿干净 JSON
lavs call addTodo --agent-dir ./bundles/todo-list \
  --input '{"text":"买牛奶","priority":1}' --quiet
```

**特点：**
- **零依赖**：任何能执行 shell 命令的 Agent 都能用。
- **可管道**：`lavs call listTodos --quiet | jq '.[] | select(.done == false)'`
- **无状态**：每次调用独立，不需要常驻进程。
- **stdout / stderr 分离**：`--quiet` 抑制诊断日志，stdout 永远是纯 JSON。

**适合：** 脚本、CI、CLI 类 Agent（ZCode、Aider）、临时操作。

### MCP 路径（`lavs serve` / `lavs serve-registry`）

```jsonc
// Claude Code / Cursor 的 MCP 配置
{
  "mcpServers": {
    "lavs": {
      "command": "npx",
      "args": ["lavs-runtime", "serve-registry", "--registry-dir", "/abs/path/to/bundles"]
    }
  }
}
```

启动后 Agent 自动获得工具：
- `lavs_discover` —— 列出所有 bundle 及端点 schema
- `lavs_call` —— 调用任意端点（Agent 从 discover 输出里选 bundle + endpoint）

**特点：**
- **工具自描述**：Agent 通过 `lavs_discover` 自己发现可用端点和参数 schema，不需要人提前告诉它。
- **原生集成**：MCP 客户端里工具跟内置工具一样，Agent 无需写 shell 命令。
- **schema 驱动**：参数经 zod 校验，错误更早暴露。

**适合：** Claude Code、Cursor、其他 MCP 客户端；想让 Agent 自主探索 bundle 能力的场景。

## 核心差异表

| 维度 | CLI (`lavs call`) | MCP (`lavs serve`) |
|---|---|---|
| Agent 集成方式 | 执行 shell 命令 | MCP 协议（stdio） |
| Agent 自发现能力 | 需人或 Agent 先读 `lavs.json` | `lavs_discover` 自动列出 |
| 参数校验 | 运行时 JSON Schema | zod schema，调用前校验 |
| 输出 | stdout JSON | MCP tool result |
| 常驻进程 | 不需要 | 需要（stdio 挂着） |
| view 自动刷新 | ✅（通知 host） | ✅（通知 host） |

## View 刷新：两条路径都支持

无论用 CLI 还是 MCP，只要有一个 `lavs view` / `lavs daemon` 在跑，mutation 执行后 view 都会经 SSE 自动刷新。

```
                    ┌─────────────────┐
   lavs call ───────▶│                 │
   (CLI)             │  tool-generator │─── POST /api/notify ──▶ Host ──▶ SSE ──▶ View
                    │  (统一通知点)    │
   lavs_call ───────▶│                 │
   (MCP tool)        └─────────────────┘
```

## 常见组合

### 组合 1：Claude Code + 常驻 view（推荐给桌面用户）

```bash
# 一次性：装 daemon，开机自启 view
lavs daemon install --registry-dir ~/my-bundles --port 7842
```

然后在 Claude Code 的 MCP 配置加 `serve-registry`。Agent 调用 `lavs_call` 后，浏览器里的 view 自动刷新。

### 组合 2：ZCode / 脚本 + 临时 view

```bash
# 终端 1：起 view（关掉就停）
lavs view --registry-dir ./bundles

# 终端 2 / Agent：用 CLI 操作
lavs call addTodo --agent-dir ./bundles/todo-list --input '{"text":"测试"}'
```

### 组合 3：纯 CLI，不要 view

```bash
# 只用 CLI 操作数据，不需要可视化
lavs call listTodos --agent-dir ./bundles/todo-list --quiet | jq '.length'
```

## 反模式：别绕过 LAVS 直接跑脚本

```bash
# ❌ 错误：直接跑 bundle 脚本
node ./bundles/todo-list/scripts/add.js '{"text":"xxx"}'

# ✅ 正确：用 lavs call
lavs call addTodo --agent-dir ./bundles/todo-list --input '{"text":"xxx"}'
```

直接跑脚本会绕过 LAVS 的输入校验、权限检查、超时控制，且**不会通知 host**——view 不会刷新。`lavs_discover` 的工具描述里也反复强调这一点。
