# LAVS — Implementation Status

> Living status document. The README Roadmap and this file track what is actually
> built versus planned. Written after a code audit on 2026-07-15, when the
> repo was found to be drifting ahead of its own docs (SDKs were described as
> "to be extracted" though they already live here).
> Last updated: 2026-07-28 (repositioning to CLI-first + standalone host; MVP roadmap added)

## Repositioning (2026-07-28)

LAVS has repositioned from "an agent's face" to **a CLI-first structured-data visualization layer**:

| | v1.0 framing | Current framing |
|---|---|---|
| Primary abstraction | An **agent**'s view | A **content-type**'s view bundle |
| Host dependency | AgentStudio (required) | Standalone lightweight host (any browser tab) |
| Agent interface | MCP tools (`lavs_xxx`) | **CLI-first** + SKILL.md; MCP optional |
| Target users | AgentStudio users | Any agent user, any host |

**MVP priority (Phase 1):** `lavs view` command — starts a local HTTP host + opens a browser tab. Agent interacts via `lavs call <endpoint>` CLI; view auto-refreshes via SSE. No MCP required.

**Official bundles (Phase 2):** `lavs/todo-list`, `lavs/daily-note`, `lavs/data-table` as showcase bundles distributed with the package.

---

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

## MVP Roadmap (CLI-first + standalone host)

### Phase 1 — Standalone Host + CLI (current priority)

| Feature | Status | Notes |
|---------|--------|-------|
| `lavs discover [--registry-dir .]` | ✅ Done | Scan dir for lavs.json files, output bundle info |
| `lavs call <endpoint> [--input '{}']` | ✅ Done | Direct CLI invocation; stdout is clean JSON for piping |
| `lavs view [contentType]` | ✅ Done | Start local HTTP host + open browser tab |
| Standalone host UI | ✅ Done | Dark-mode UI: left sidebar bundle list + right iframe renderer |
| Host SSE bridge | ✅ Done | Push agent-action events into active iframe; view auto-refreshes |
| `SKILL.md` for lavs | ✅ Done | Root-level SKILL.md instruct agents when/how to use lavs CLI |

### Phase 2 — dispatch mode + official bundles

| Feature | Status | Notes |
|---------|--------|-------|
| dispatch algorithm in host | ⬜ Planned | v1.1 spec written, not yet implemented |
| Official bundle: `lavs/todo-list` | ✅ Done | Full CRUD (add/toggle/delete/clearDone) + priority + tags + view |
| Official bundle: `lavs/daily-note` | ⬜ Planned | |
| Official bundle: `lavs/data-table` | ⬜ Planned | Generic tabular data view |
| npm publish `@lavs/runtime` + `@lavs/client` | ⬜ Planned | |

### Phase 3 — ecosystem

| Feature | Status | Notes |
|---------|--------|-------|
| Third-party bundle publishing guide | ⬜ Planned | |
| Electron/Tauri standalone app (optional upgrade) | ⬜ Planned | If browser tab UX is insufficient |
| Python runtime dispatch layer | ⬜ Planned | |

---

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

## Recent changes (2026-07-16 — v1.1 View Dispatch Protocol)

- **Repositioning**: the protocol's primary abstraction is now a
  **content-type** (a type of structured data), not an agent. A manifest is a
  **view bundle** — portable across agents/scenarios. Two first-class host
  modes: `pinned` (v1.0 behavior, one bundle) and `dispatch` (many bundles,
  rendered per artifact by content-type). Design draft: `docs/DISPATCH-PROTOCOL.md`.
- **SPEC.md** bumped to 1.1.0-draft: added §11 View Dispatch Protocol
  (normative), `contentType` manifest field, artifact envelope, view registry,
  per-`(conversation, contentType)` data scope, normative fallback rendering,
  dispatch-mode security (§11.8), `lavs-agent-action` gains `contentType` +
  recommends `result`.
- **Schema/types**: added optional `contentType` to `schema/lavs-manifest.schema.json`,
  TS `@lavs/types` + runtime + client types, and Python `lavs_types` (Pydantic,
  alias `contentType`). Loaders (TS + Python) validate the `contentType` pattern
  when present. Tests added (TS loader +3, Python loader +2). Full suites green
  (TS 158, Python 38).
- **Not yet implemented**: the dispatch algorithm, view registry loader, and
  per-scope data isolation are spec-only in v1.1; the runtime still behaves as
  v1.0 pinned mode. Reference dispatch implementation is the next milestone
  (proposed: an AgentStudio dispatch-mode branch).

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
