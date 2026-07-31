# AGENTS.md — LAVS (Local Agent View Service)

> Local Agent View Service：桥接 AI Agent 与可视化 UI 的协议与 SDK。
> 负责人：jeffkit | 创建：2026-03-01
> 本文件是 AI / 开发者进入仓库的**唯一导航契约**。（`CLAUDE.md` 为本文件的软链，Claude Code 入口。）

## 项目概述

LAVS 让本地 Agent 通过 `lavs.json` 清单暴露 View / Query / Mutation / Subscription，供前端渲染并可双向同步。
补齐 MCP Tools / Resources 与 A2A 之上「Agent 面孔」这一层。
本仓含协议规范、JSON Schema，以及 TypeScript / Python SDK（types + runtime + client）；预发布，已在 AgentStudio 集成。

**技术栈：** TypeScript, pnpm, Python, Pydantic, JSON Schema, MCP
**主仓库：** `git@github.com:jeffkit/lavs.git`

## Project Status

**Phase**: Pre-release (protocol hardened, integrated in AgentStudio)
**当前里程碑：** Pre-release（协议已硬化）— {待人工确认细节}

## 架构地图

清单 → runtime 校验/鉴权/执行 handler → 前端 client 或 MCP tools。
协议权威文档在 `docs/SPEC.md`；实现以 `sdk/` 为准。

关键目录：
- `docs/SPEC.md` — 协议规范 v1.1（含 §11 View Dispatch Protocol）
- `docs/DISPATCH-PROTOCOL.md` — v1.1 分发协议设计草案（重新定位：content-type 为主抽象，pinned/dispatch 两宿主模式）
- `schema/lavs-manifest.schema.json` — 清单 JSON Schema
- `sdk/typescript/types/` — `@lavs/types`
- `sdk/typescript/runtime/src/` — `@lavs/runtime`（loader、validator、executors、mcp-server、CLI）
- `sdk/typescript/client/` — `@lavs/client`
- `sdk/python/` — `lavs_types` / `lavs_runtime` / `lavs_client`
- `skill/SKILL.md` — Agent 使用 Skill

## Directory Structure

> 注：以下目录树沿用从 AgentStudio 抽离前的历史视角（含 `platform/lavs/`、`agentstudio/` 等路径）；
> 本仓实际结构以上方「架构地图 / 关键目录」为准。

```
platform/lavs/
├── docs/
│   ├── SPEC.md                        # Full protocol specification v1.0
│   └── PROTOCOL-ANALYSIS.md           # Gap analysis & improvement findings
├── sdk/
│   ├── typescript/                     # TypeScript/Node.js SDK
│   │   ├── types/src/index.ts          # Core type definitions (published: @lavs/types)
│   │   ├── runtime/src/                # Server-side runtime (published: @lavs/runtime)
│   │   │   ├── loader.ts                 # Manifest loader
│   │   │   ├── validator.ts              # JSON Schema validation
│   │   │   ├── permission-checker.ts    # Permission enforcement
│   │   │   ├── script-executor.ts        # Script handler execution
│   │   │   ├── function-executor.ts      # Function handler execution
│   │   │   ├── http-executor.ts         # HTTP handler execution
│   │   │   ├── rate-limiter.ts           # Per-endpoint rate limiting
│   │   │   ├── subscription-manager.ts    # SSE subscription management
│   │   │   ├── tool-generator.ts         # Generate AI tools from manifest
│   │   │   ├── mcp-server.ts             # Expose LAVS as MCP tools (stdio)
│   │   │   ├── cli.ts                    # `lavs-runtime` CLI (serve/init/validate)
│   │   │   └── types.ts                  # Core type definitions
│   │   └── client/src/                 # Client SDK (published: @lavs/client)
│   └── python/                         # Python SDK (active)
│       ├── lavs_types/                 # Pydantic models
│       ├── lavs_runtime/               # Runtime (loader/validator/permission-checker/rate-limiter/script-executor)
│       └── lavs_client/                # Client SDK
├── schema/
│   └── lavs-manifest.schema.json       # JSON Schema for manifest validation
├── examples/jarvis-agent/              # Example agent (to be populated)
├── README.md                           # Project overview & quick start
└── CLAUDE.md                           # Symlink to AGENTS.md
```

The `sdk/` directory is organized by language, each providing types, runtime, and client packages.

## Reference Implementation

The **protocol specification and SDKs (TypeScript + Python) live in THIS repository** under `sdk/`. The runtime modules below are the canonical reference implementations:

- **TypeScript runtime** (`sdk/typescript/runtime/src/` → published as `@lavs/runtime`):
  - `loader.ts` — Manifest loader
  - `validator.ts` — JSON Schema validation
  - `permission-checker.ts` — Permission enforcement
  - `script-executor.ts` — Script handler execution
  - `function-executor.ts` — Function handler execution
  - `http-executor.ts` — HTTP handler execution
  - `rate-limiter.ts` — Per-endpoint rate limiting
  - `subscription-manager.ts` — SSE subscription management
  - `tool-generator.ts` — Generate AI tools from manifest
  - `mcp-server.ts` — Expose LAVS endpoints as MCP tools (stdio transport)
  - `cli.ts` — `lavs-runtime` CLI (`serve` / `init` / `validate`)
  - `types.ts` — Core type definitions

- **TypeScript client** (`sdk/typescript/client/src/` → published as `@lavs/client`):
  - `client.ts` — LAVSClient (`call`, `subscribe`, `getManifest`)
  - `types.ts` — Frontend type re-exports

- **Python SDK** (`sdk/python/`):
  - `lavs_types/` — Pydantic models
  - `lavs_runtime/` — loader / validator / permission-checker / rate-limiter / script-executor
  - `lavs_client/` — Client SDK

The **integration host** is AgentStudio (`feature/lavs-poc` branch, `agentstudio/.worktrees/lavs/`)，HTTP transport、REST/SSE routes（`backend/src/routes/lavs.ts`）与前端 view bridge 在那里接线。本地 `lavs.json` 清单由上述 runtime 加载执行。

## Key Design Decisions

1. **SSE for subscriptions** (not WebSocket) — simpler, HTTP/2 compatible
2. **iframe for view isolation** — security, independent CSP, no React state pollution
3. **CSP nonce** (not unsafe-inline) — prevents arbitrary script injection
4. **Publish endpoint restricted** — internal secret required, prevents event injection
5. **One Agent UI = One LAVS** — no multi-agent sharing
6. **Local only** — no remote LAVS in current roadmap
7. **ADVISORY vs ENFORCED permissions** — honest about OS-level enforcement limits

## 开发约定

**分支策略：** `main`；PR 合并。版本用 Changesets。

**禁止事项：**
- 禁止改协议行为却不同步 `docs/SPEC.md` 与 `schema/`
- 禁止只改 TS 或 Python 一侧导致双端语义漂移
- 禁止在 SDK 中硬编码业务 Agent 清单（用 examples / 业务仓）

## 常用命令

```bash
pnpm install
pnpm build                    # types → runtime → client
pnpm test                     # TS runtime 测试
cd sdk/python && uv sync && uv run pytest

# 历史集成测试（AgentStudio worktree 内）
cd agentstudio/.worktrees/lavs/backend
pnpm run test:run -- src/lavs/
pnpm run test:run -- src/routes/__tests__/lavs.test.ts
```

## 深入阅读

| 文档 | 说明 |
|------|------|
| `README.md` | 快速开始与问题域 |
| `docs/SPEC.md` | 完整协议 |
| `docs/PROTOCOL-ANALYSIS.md` | 缺口分析 |
| `schema/lavs-manifest.schema.json` | manifest IDE 自动补全 |

## Related Projects

- **AgentStudio** (`../../agentstudio/`) — Primary integration host
- `specs/002-lavs-protocol/` — Planning documents (spec.md, plan.md)
