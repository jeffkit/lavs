# LAVS — Implementation Status

> Living status document. The README Roadmap and this file track what is actually
> built versus planned. Written after a code audit on 2026-07-15, when the
> repo was found to be drifting ahead of its own docs (SDKs were described as
> "to be extracted" though they already live here).

## TL;DR

- The **protocol spec (v1.0) and the TypeScript + Python SDKs live in this
  repository** under `sdk/`. They are no longer "to be extracted" from
  AgentStudio — README and CLAUDE.md previously said so and have been corrected.
- **Handler execution**: `script` Done, `function` Done, `http` Done (TypeScript
  only), `mcp` Done (TypeScript only — `McpExecutor` connects to an external
  MCP server described in `mcp-config.json`; the *reverse* path — exposing LAVS
  as MCP tools — is also Done via `lavs-runtime serve`).
- **CLI**: `serve` Done, `init` Done (new), `validate` Done (new).
- **Security**: ENFORCED paths (path-traversal check, input JSON-Schema,
  timeout-kill) are real. ADVISORY permissions (`fileAccess`,
  `networkAccess`, `maxMemory`) are declared but **not** OS-enforced — they
  rely on Docker/nsjail for real isolation.

## Handler support matrix

| Handler  | Loader/Validator accepts | TS runtime executes | Python runtime executes |
|-----------|---------------------------|----------------------|---------------------------|
| `script`  | Yes                       | Yes — `ScriptExecutor` | Yes — `ScriptExecutor`    |
| `function`| Yes                       | Yes — `FunctionExecutor`| No (no dispatch layer)  |
| `http`    | Yes                       | Yes — `HttpExecutor` (new) | No (planned)            |
| `mcp`     | Yes                       | Yes — `McpExecutor` (new) | No (planned)            |

Note: `mcp-server.ts` is the **reverse** bridge (LAVS → MCP tools). The
`mcp` *handler type* (LAVS endpoint → external MCP tool) is now implemented
in `mcp-executor.ts` (`McpExecutor`), driven by `mcp-config.json`.

## Package / module status

| Package            | Path                        | Status      | Notes                                                        |
|--------------------|-----------------------------|-------------|-------------------------------------------------------------|
| `@lavs/types`     | `sdk/typescript/types`     | Done        | Core types, incl. `HTTPHandler.timeout`                           |
| `@lavs/runtime`   | `sdk/typescript/runtime`   | Done        | loader, validator, permission-checker, script/function/http executors, rate-limiter, subscription-manager, tool-generator, mcp-server, cli |
| `@lavs/client`    | `sdk/typescript/client`    | Done        | `LAVSClient.call / subscribe / getManifest`                         |
| Python `lavs_types`| `sdk/python/lavs_types`   | Done        | Pydantic models                                              |
| Python `lavs_runtime`| `sdk/python/lavs_runtime` | Partial     | loader/validator/permission-checker/rate-limiter/script-executor present; **no endpoint dispatch / tool-generator equivalent**, so handler types beyond `script` are not wired end-to-end |
| Python `lavs_client`| `sdk/python/lavs_client`   | Partial     | client present, execution side incomplete                         |

## CLI

```
npx lavs-runtime serve    --agent-dir <dir> [--agent-id <id>] [--project-path <p>]
npx lavs-runtime init     --agent-dir <dir>     # scaffolds a minimal lavs.json
npx lavs-runtime validate --agent-dir <dir>     # loads + validates lavs.json
```

## Architecture (data flow)

```
Chat UI  ── AI calls lavs_<endpoint>() ─┐
                                       ├─▶ LAVSToolGenerator ─▶ handler executor (script/function/http/mcp)
View UI  ── postMessage('lavs-call') ─┘        │
   ▲                                      │ manifest: lavs.json
   │ onAgentAction (refresh)                   ▼
   └───────────────────────────────── LAVS Runtime (this repo, sdk/typescript/runtime)
                                            │
                                            ├─ HTTP / JSON-RPC 2.0  → /api/agents/:id/lavs/:endpoint
                                            └─ SSE                  → /api/agents/:id/lavs/:endpoint/subscribe
```

`lavs-runtime serve` additionally starts an MCP server (stdio) that exposes every
query/mutation endpoint as an MCP tool named `lavs_<endpointId>`, so any
MCP-compatible client (Claude Code, Cursor, etc.) can drive a LAVS agent.

## Known gaps / honest caveats

1. **ADVISORY permissions are not enforced.** `fileAccess`, `networkAccess`,
   and `maxMemory` are documented intent only. A malicious or compromised
   `lavs.json`/view can read/write outside declared paths or reach the
   network. Wrap with OS sandboxing (Docker, nsjail) before running
   untrusted manifests.
2. **Python runtime has no endpoint dispatch layer.** It has the building
   blocks (loader/validator/executor) but no `tool-generator` equivalent,
   so only `script` handlers are currently reachable end-to-end. `http`
   and `mcp` handler execution are also still TODO on the Python side.
3. **No independent publish yet.** Packages are structured for publish but not
   yet on npm/PyPI; local use is via the pnpm workspace (`pnpm install`).

## Recent changes (2026-07-15 audit)

- Added `HttpExecutor` (`sdk/typescript/runtime/src/http-executor.ts`) and wired
  it into `tool-generator.ts` switch + `index.ts` export. Verified with
  `http-executor.test.ts` (JSON parse, request body, error code, timeout,
  non-JSON fallback).
- Added `http` to CLI-adjacent tool generation; uses global `fetch` with an
  `AbortController` timeout.
- Added `init` and `validate` commands to the `lavs-runtime` CLI.
- Added `timeout?` to `HTTPHandler` in all three type defs (runtime / types /
  client) for consistency.
- Corrected README (Roadmap, Handler Types table) and CLAUDE.md (Directory
  Structure, Reference Implementation), which incorrectly stated SDKs were
  "to be extracted" and that handlers/CLI were only planned — they already
  exist in this repository.

## Recent changes (2026-07-15, part 2 — mcp handler)

- Added `McpExecutor` (`sdk/typescript/runtime/src/mcp-executor.ts`): the
  *forward* MCP bridge. Reads `mcp-config.json` from the agent dir, builds a
  stdio or Streamable-HTTP transport, connects a client, and calls the named
  tool — mapping `isError`/timeout to `LAVSError` (HandlerError / Timeout)
  and returning `structuredContent` or parsed JSON text.
- Wired `mcp` into `tool-generator.ts` switch + `index.ts` export; added
  `McpServerConfig` / `McpConfigFile` types (runtime / types / client).
- `mcp` handler type is now end-to-end implemented (verified by
  `mcp-executor.test.ts` + a generator integration test, both spawning a
  fixture MCP stdio server).
- `lavs-runtime validate` now also checks an adjacent `mcp-config.json`
  when present (see `schema/mcp-config.schema.json`).
- Updated README (Handler Types table) and SPEC 8.3 (mcp-config.json format).
