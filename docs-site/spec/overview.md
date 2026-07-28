# 协议总览

LAVS（Local Agent View Service）让本地 Agent 把结构化数据以可交互 UI 呈现，并与对话侧双向同步。

## 它解决什么问题

当前 AI Agent 的协议栈有这几层：

```
┌────────────────────────────────────────────────────┐
│     Visual Layer (LAVS)     ← Agent 的「面孔」     │
│  View + Query + Mutation + Subscription + AI Sync   │
├────────────────────────────────────────────────────┤
│     Context Layer (MCP Resources)                   │
├────────────────────────────────────────────────────┤
│     Tool Layer (MCP Tools)                          │
├────────────────────────────────────────────────────┤
│     Comm Layer (A2A)                                │
└────────────────────────────────────────────────────┘
```

- **MCP Tools**：Agent ↔ 外部工具
- **MCP Resources**：Agent 的只读数据上下文
- **A2A**：Agent ↔ Agent 通信

**缺口**：没有标准方式让 Agent 把内部数据以**可交互 UI** 暴露给前端，并双向同步。

LAVS 补这一层。

## 核心概念

| 概念 | 说明 |
|---|---|
| **Manifest** | `lavs.json` 清单，声明端点、view、权限 |
| **content-type** | bundle 标识（如 `lavs/todo-list`），跨 Agent 复用 |
| **Endpoint** | `query`（读）、`mutation`（写）、`subscription`（实时） |
| **Handler** | 端点的执行方式：`script` / `function` / `http` / `mcp` |
| **View** | iframe 渲染的 UI 组件，经 postMessage 与 host 双向通信 |
| **Bundle** | 一份 manifest + view + handler 实现的完整打包 |

## 架构

```
┌──────────────┐        ┌──────────────┐
│  对话面板     │        │  LAVS View   │
│  (Agent)     │        │  (可视化面板) │
└──────┬───────┘        └──────┬───────┘
       │                       │
       │  lavs call / MCP tool │  postMessage
       │                       │
       ▼                       ▼
┌──────────────────────────────────────┐
│           LAVS Runtime               │
│  ┌──────────┐  ┌────────────────┐   │
│  │ Manifest │  │ Tool Generator │   │
│  │ Loader   │─▶│ → Executor     │   │
│  └──────────┘  └────────────────┘   │
│  ┌──────────┐  ┌────────────────┐   │
│  │Validator │  │ Host Server    │   │
│  │ (Schema) │  │ (HTTP + SSE)   │   │
│  └──────────┘  └────────────────┘   │
└──────────────────────────────────────┘
```

**数据流：**
1. Agent（经 CLI 或 MCP）调用端点
2. Runtime 校验输入、执行 handler、校验输出
3. 若是 mutation，通知 host
4. host 经 SSE 推 `agent-action` 事件给 view
5. view 自动刷新

## Handler 类型

| 类型 | 说明 | TS runtime | Python runtime |
|---|---|---|---|
| `script` | 执行 CLI 命令（node/python 等） | ✅ | ✅ |
| `function` | 调用 JS/TS 函数 | ✅ | ❌ |
| `http` | 代理到外部 HTTP 端点 | ✅ | ❌ 计划中 |
| `mcp` | 桥接外部 MCP server 工具 | ✅ | ❌ 计划中 |

## 安全模型

| 权限 | 强制度 | 说明 |
|---|---|---|
| 路径穿越 | **强制** | handler 路径校验 |
| 输入校验 | **强制** | 所有输入经 JSON Schema |
| 超时 | **强制** | 超时 kill 脚本 |
| CSP | **强制** | nonce-based 脚本策略 |
| fileAccess | 建议 | glob 模式，声明用，非 OS 强制 |
| networkAccess | 建议 | 声明用，非 OS 强制 |

::: warning 注意
`fileAccess` / `networkAccess` / `maxMemory` 是**建议级**——声明意图，但不做 OS 级强制。
运行不可信的 manifest 前，请用 Docker / nsjail 等沙箱隔离。
:::

## 完整规范

本页是精炼总览。完整协议规范见仓库：

- [docs/SPEC.md](https://github.com/jeffkit/lavs/blob/main/docs/SPEC.md) —— v1.0 完整规范（1297 行）
- [docs/DISPATCH-PROTOCOL.md](https://github.com/jeffkit/lavs/blob/main/docs/DISPATCH-PROTOCOL.md) —— v1.1 View Dispatch 设计
- [View Dispatch (v1.1)](./v1.1-dispatch) —— 本站的 v1.1 摘要

## 与 MCP 的关系

LAVS 和 MCP Resources **互补**，不竞争：

|  | LAVS | MCP Resources |
|---|---|---|
| 方向 | 双向（Agent ↔ UI） | 单向（Server → LLM） |
| 操作 | Query + Mutation + Subscription | 只读 |
| UI 绑定 | View 组件 | 无 |
| 目的 | Agent 的可视化界面 | Agent 的数据上下文 |

最佳组合：LAVS 的 `mcp` handler 用 MCP Resources 作数据源，经 LAVS View 呈现。
