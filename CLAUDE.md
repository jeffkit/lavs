# CLAUDE.md — LAVS (Local Agent View Service)

## Overview

LAVS is a protocol that bridges AI Agents and Visual UIs. This directory contains the protocol specification, type definitions, and JSON Schema for the LAVS protocol.

## Project Status

**Phase**: Pre-release (protocol hardened, integrated in AgentStudio)

## Directory Structure

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
└── CLAUDE.md                           # This file
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

The **integration host** is AgentStudio (`feature/lavs-poc` branch, `agentstudio/.worktrees/lavs/`), where the HTTP transport, REST/SSE routes (`backend/src/routes/lavs.ts`), and the frontend view bridge are wired in. Local `lavs.json` manifests are loaded and executed by the runtime above.

## Key Design Decisions

1. **SSE for subscriptions** (not WebSocket) — simpler, HTTP/2 compatible
2. **iframe for view isolation** — security, independent CSP, no React state pollution
3. **CSP nonce** (not unsafe-inline) — prevents arbitrary script injection
4. **Publish endpoint restricted** — internal secret required, prevents event injection
5. **One Agent UI = One LAVS** — no multi-agent sharing
6. **Local only** — no remote LAVS in current roadmap
7. **ADVISORY vs ENFORCED permissions** — honest about OS-level enforcement limits

## Development

### Testing

```bash
# Run LAVS unit tests
cd agentstudio/.worktrees/lavs/backend
pnpm run test:run -- src/lavs/

# Run route integration tests
pnpm run test:run -- src/routes/__tests__/lavs.test.ts
```

### Spec Files

- **Full spec**: `docs/SPEC.md`
- **Planning**: `../../specs/002-lavs-protocol/plan.md`
- **JSON Schema**: `schema/lavs-manifest.schema.json` (for IDE autocomplete in lavs.json)

## Related Projects

- **AgentStudio** (`../../agentstudio/`) — Primary integration host
- **specs/002-lavs-protocol/** — Planning documents (spec.md, plan.md)
