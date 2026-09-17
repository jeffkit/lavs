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
- `sdk/typescript/view/` — `@lavs/view`（view 侧 SDK：postMessage 桥 + UI command registry，IIFE 产物供无构建 bundle 视图直接 `<script>` 引入）
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

## NPM 发布维护 Checklist

**发布链**：`Release` workflow (`push main`) → `changesets/action@v1` → `pnpm release` → `changeset publish`。

**`NPM_TOKEN` 是发布卡点**——只有 token 归属账号对 `lavs-client` / `lavs-runtime` / `lavs-types` 有写入权限，发布才能成功。
若 release.yml 报 `npm error 404 Not Found - PUT https://registry.npmjs.org/<pkg> - Not found`，**不是协议或权限配置错，而是 token 归属错**。

### 何时需轮换 token
- npm 控制台轮换 token（创建 Automation token）。
- 仓库成员变更（离职/换岗）。
- GitHub Secret 误删/失窃。

### 本地验证 token 归属
```bash
npm login --registry=https://registry.npmjs.org   # 输入当前 NPM_TOKEN 同账号
npm whoami                                        # 应返回 jeffkit
npm access ls-packages lavs-client                # 应能列出（即 token 是 maintainer）
npm access ls-packages lavs-runtime
npm access ls-packages lavs-types
```
任一条命令失败或返回空 → token 没有写入权限，需要去 npmjs.com 重新签发。

### GitHub Secret 配置
- Repo → Settings → Secrets and variables → Actions → `NPM_TOKEN`
- 选 **Automation** token（非 user token；user token 受 2FA / IP 限制）
- 勾选 scope: `Publish`（`Read and write` 也可）

### 预检
`release.yml` 已在 publish 之前跑 `pnpm changeset status`（`continue-on-error: true`，仅做日志），
token 失效时 status 输出会先于 publish 给出 hints，便于早期发现。

### 防御性 publishConfig
三个 SDK `package.json` 已显式声明 `"publishConfig": { "access": "public" }`，
确保即使 token 改了 npmjs 默认策略，unscoped 包仍按 public 发布。

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
