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
│   │   ├── types/src/index.ts          # Core type definitions
│   │   ├── runtime/src/                # Reference runtime (to be extracted)
│   │   └── client/src/                 # Client SDK (to be extracted)
│   └── python/                         # Python SDK (planned)
│       ├── lavs_types/                 # Pydantic models
│       ├── lavs_runtime/               # Runtime
│       └── lavs_client/                # Client SDK
├── schema/
│   └── lavs-manifest.schema.json       # JSON Schema for manifest validation
├── examples/jarvis-agent/              # Example agent (to be populated)
├── README.md                           # Project overview & quick start
└── CLAUDE.md                           # This file
```

The `sdk/` directory is organized by language, each providing types, runtime, and client packages.

## Reference Implementation

The working implementation lives in the AgentStudio LAVS worktree:

- **Backend runtime**: `agentstudio/.worktrees/lavs/backend/src/lavs/`
  - `loader.ts` — Manifest loader
  - `validator.ts` — JSON Schema validation
  - `permission-checker.ts` — Permission enforcement
  - `script-executor.ts` — Script handler execution
  - `function-executor.ts` — Function handler execution
  - `rate-limiter.ts` — Per-endpoint rate limiting
  - `subscription-manager.ts` — SSE subscription management
  - `tool-generator.ts` — Generate AI tools from manifest
  - `mcp-bridge.ts` — Expose LAVS as MCP tools
  - `types.ts` — Core type definitions

- **Frontend client**: `agentstudio/.worktrees/lavs/frontend/src/lavs/`
  - `client.ts` — LAVSClient (call, subscribe, getManifest)
  - `types.ts` — Frontend type re-exports

- **Routes**: `agentstudio/.worktrees/lavs/backend/src/routes/lavs.ts`

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
