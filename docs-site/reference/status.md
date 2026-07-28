# 实现状态

LAVS 各组件的实现进度。本文档追踪「实际构建了什么 vs 计划了什么」。

## 重新定位（2026-07-28）

LAVS 已从「Agent 的脸」重新定位为 **CLI 优先的结构化数据可视化层**：

|  | v1.0 定位 | 当前定位 |
|---|---|---|
| 主抽象 | 一个 **Agent** 的 view | 一个 **content-type** 的 view bundle |
| Host 依赖 | AgentStudio（必需） | 独立轻量 host（任意浏览器 tab） |
| Agent 接口 | MCP 工具（`lavs_xxx`） | **CLI 优先** + SKILL.md；MCP 可选 |
| 目标用户 | AgentStudio 用户 | 任何 Agent 用户，任何 host |

## Handler 支持矩阵

| Handler | Loader/Validator 接受 | TS runtime 执行 | Python runtime 执行 |
|---|---|---|---|
| `script` | ✅ | ✅ `ScriptExecutor` | ✅ `ScriptExecutor` |
| `function` | ✅ | ✅ `FunctionExecutor` | ❌ 无 dispatch 层 |
| `http` | ✅ | ✅ `HttpExecutor` | ❌ 计划中 |
| `mcp` | ✅ | ✅ `McpExecutor` | ❌ 计划中 |

## 包状态

| 包 | 路径 | 状态 |
|---|---|---|
| `@lavs/types` | `sdk/typescript/types` | ✅ 完成 |
| `@lavs/runtime` | `sdk/typescript/runtime` | ✅ 完成 |
| `@lavs/client` | `sdk/typescript/client` | ✅ 完成 |
| Python `lavs_types` | `sdk/python/lavs_types` | ✅ 完成（Pydantic 模型） |
| Python `lavs_runtime` | `sdk/python/lavs_runtime` | ⚠️ 部分（无 endpoint dispatch） |
| Python `lavs_client` | `sdk/python/lavs_client` | ⚠️ 部分 |

## MVP Roadmap

### Phase 1 — 独立 Host + CLI（已完成）

| 功能 | 状态 |
|---|---|
| `lavs discover` | ✅ |
| `lavs call` | ✅ |
| `lavs view` | ✅ |
| 独立 host UI | ✅ |
| Host SSE 桥 | ✅ |
| `SKILL.md` | ✅ |
| `lavs daemon`（常驻） | ✅ launchd / systemd |
| `--quiet` 抑制诊断日志 | ✅ |
| 端口解耦（`LAVS_HOST_PORT`） | ✅ |

### Phase 2 — dispatch 模式 + 官方 bundle

| 功能 | 状态 |
|---|---|
| dispatch 算法 | ❌ 计划中 |
| 官方 bundle `lavs/todo-list` | ✅ |
| 官方 bundle `lavs/daily-note` | ❌ 计划中 |
| 官方 bundle `lavs/data-table` | ❌ 计划中 |
| npm 发布 `@lavs/runtime` + `@lavs/client` | ❌ 计划中 |

### Phase 3 — 生态

| 功能 | 状态 |
|---|---|
| 第三方 bundle 发布指南 | ❌ 计划中 |
| Electron/Tauri 独立 app（可选） | ❌ 计划中 |
| Python runtime dispatch 层 | ❌ 计划中 |

## 已知的诚实声明

1. **建议级权限未强制**。`fileAccess`、`networkAccess`、`maxMemory` 仅声明意图。
   恶意或被攻破的 manifest 可读写声明路径之外的数据。运行不可信 manifest 前请用沙箱隔离。

2. **Python runtime 无 endpoint dispatch 层**。有构建块（loader/validator/executor）
   但无 `tool-generator` 等价物，目前仅 `script` handler 端到端可用。

3. **尚未独立发布**。包结构已就绪，但未上 npm/PyPI；本地用 pnpm workspace。

## 完整审计文档

更详细的审计与变更历史见仓库：

- [docs/STATUS.md](https://github.com/jeffkit/lavs/blob/main/docs/STATUS.md) —— 完整实现状态
