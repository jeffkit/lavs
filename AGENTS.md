# AGENTS.md — LAVS

> Local Agent View Service：桥接 AI Agent 与可视化 UI 的协议与 SDK。
> 负责人：jeffkit | 创建：2026-03-01

## 项目概述

LAVS 让本地 Agent 通过 `lavs.json` 清单暴露 View / Query / Mutation / Subscription，供前端渲染并可双向同步。  
补齐 MCP Tools / Resources 与 A2A 之上「Agent 面孔」这一层。  
本仓含协议规范、JSON Schema，以及 TypeScript / Python SDK（types + runtime + client）；预发布，已在 AgentStudio 集成。

**技术栈：** TypeScript, pnpm, Python, Pydantic, JSON Schema, MCP  
**主仓库：** `git@github.com:jeffkit/lavs.git`

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
```

## 当前状态

**当前里程碑：** Pre-release（协议已硬化）— {待人工确认细节}

## 深入阅读

| 文档 | 说明 |
|------|------|
| `README.md` | 快速开始与问题域 |
| `docs/SPEC.md` | 完整协议 |
| `docs/PROTOCOL-ANALYSIS.md` | 缺口分析 |
| `CLAUDE.md` | 目录与 runtime 模块说明 |
