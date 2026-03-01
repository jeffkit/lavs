# LAVS Protocol Deep Analysis

**Document Version:** 1.0  
**Analysis Date:** 2025-02-16  
**Scope:** LAVS worktree at `agentstudio/.worktrees/lavs/`

---

## Executive Summary

LAVS (Local Agent View Service) is a well-structured protocol for connecting local AI agents to visual UI components. The implementation demonstrates solid foundations in manifest design, JSON-RPC transport, and security-conscious execution. However, several critical gaps exist in security, state synchronization, protocol completeness, and interoperability. This analysis categorizes issues by severity and provides concrete improvement proposals.

---

## 1. Protocol Design

### 1.1 JSON-RPC 2.0 Choice

**Assessment:** JSON-RPC 2.0 is a reasonable choice for request-response semantics. It provides:
- Standardized error codes
- Request ID correlation
- Language-agnostic format

**Gaps:**
- **Spec vs. Implementation Mismatch:** The spec defines `lavs/call`, `lavs/subscribe`, `lavs/unsubscribe` as JSON-RPC methods, but the HTTP routes use REST-style URLs (`POST /api/agents/:agentId/lavs/:endpoint`) rather than a single JSON-RPC endpoint. The client (`client.ts`) uses `fetch` with REST URLs, not JSON-RPC envelopes.

```typescript
// client.ts:108 - Uses REST, not JSON-RPC
const url = `${this.baseURL}/api/agents/${this.agentId}/lavs/${endpointId}`;
const response = await fetch(url, {
  method: 'POST',
  body: JSON.stringify(input || {}),
});
```

- **No Batch Support:** JSON-RPC 2.0 supports batch requests; LAVS does not. For AI agents making multiple endpoint calls, batching could reduce round trips.

**Improvement Proposals:**
1. Add a unified JSON-RPC endpoint `POST /api/agents/:agentId/lavs/rpc` that accepts `{ jsonrpc, id, method, params }` for spec compliance.
2. Document the dual transport (REST for simplicity, JSON-RPC for spec) and recommend when to use each.
3. Consider batch support for `lavs/call` in future versions.

### 1.2 Abstractions

**Strengths:**
- Clean separation: Manifest → Loader → Executor → Validator
- Handler polymorphism (script, function, http, mcp) is well-typed

**Gaps:**
- **Subscription Transport Inconsistency:** Spec says WebSocket for subscriptions; implementation uses SSE. The subscription manager (`subscription-manager.ts`) uses `text/event-stream`, not WebSocket.

```typescript
// subscription-manager.ts:116-121 - SSE, not WebSocket
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
});
```

- **Missing `lavs/data` Push Format:** Spec defines server-initiated `lavs/data` with `subscriptionId`; implementation uses SSE events with `event` and `data` fields. The event format differs from the spec.

### 1.3 Spec Completeness

| Spec Section | Implementation Status |
|--------------|------------------------|
| Manifest schema | ✅ Implemented |
| Script/Function handlers | ✅ Implemented |
| HTTP/MCP handlers | ❌ 501 Not Implemented |
| Subscription (WebSocket) | ⚠️ Implemented as SSE |
| View component contract | ⚠️ Partial (local only fully wired) |
| `readFile` in LAVSClient | ❌ Not implemented |

---

## 2. Security

### 2.1 Critical Issues

#### C-1: postMessage with `'*'` Origin

**Location:** `LAVSViewContainer.tsx:154`, `LAVSViewContainer.tsx:196-207`

```typescript
iframeRef.current.contentWindow.postMessage(message, '*');
```

**Risk:** Any origin can receive these messages. Malicious pages could eavesdrop on LAVS agent actions or inject fake responses.

**Fix:** Use `targetOrigin` from `window.location.origin` or a configured LAVS origin:

```typescript
iframeRef.current.contentWindow.postMessage(message, window.location.origin);
```

#### C-2: Inline Script Injection in lavs-view

**Location:** `lavs.ts:391-402`

```typescript
const lavsContextScript = `<script>
  window.LAVS_AGENT_ID = "${escapeForJS(agentId)}";
  window.LAVS_PROJECT_PATH = "${escapeForJS(projectPath)}";
</script>`;
```

**Risk:** `escapeForJS` handles `\`, `"`, `<`, `>`, `\n` but not all Unicode escapes or `\u0000`-style sequences. If `agentId` or `projectPath` come from user input, edge cases could allow script injection.

**Fix:** Use a stricter escaping function (e.g., JSON.stringify for values) or inject via a data attribute and read in a separate script.

#### C-3: CSP Allows `'unsafe-inline'`

**Location:** `lavs.ts:410-411`

```typescript
"script-src 'self' 'unsafe-inline'",
"style-src 'self' 'unsafe-inline'",
```

**Risk:** Any inline script in the view HTML runs. If the view component is loaded from an untrusted path, XSS is possible.

**Fix:** Use nonces or hashes for CSP. For local components, consider serving them from a separate origin with stricter CSP.

#### C-4: Subscription Publish Endpoint Unprotected

**Location:** `lavs.ts:327-356`

```typescript
router.post('/:agentId/lavs/:endpoint/publish', async (req, res) => {
  const event = req.body;
  subscriptionManager.publish(agentId, endpointId, event);
});
```

**Risk:** Any client can POST to `/publish` and push arbitrary events to all subscribers. No authentication or authorization. This could be used to inject fake "mutation" events into view components.

**Fix:** Require authentication; optionally verify that the publisher is the same process that executed the mutation (e.g., server-side only, or signed tokens).

### 2.2 Important Issues

#### I-1: fileAccess Not Enforced at Runtime

**Location:** `permission-checker.ts`, `script-executor.ts`

The `PermissionChecker` validates `cwd` and `command` path traversal, but does **not** intercept file system access during script execution. A script can `fs.readFile('../../etc/passwd')` if the process has access. The `fileAccess` glob patterns are declarative only.

**Fix:** Implement a file access interceptor (e.g., via `LD_PRELOAD` on Linux, or a wrapper that audits syscalls). Alternatively, run scripts in a sandbox (e.g., `nsjail`, `firecracker`) that enforces the manifest.

#### I-2: networkAccess Not Enforced

**Location:** `permission-checker.ts`, `script-executor.ts`

`permissions.networkAccess` is defined in the manifest but never checked. Scripts can make arbitrary network requests.

**Fix:** Use network namespaces, `iptables`, or a proxy to enforce network restrictions. Document that this is not yet enforced.

#### I-3: maxMemory Not Implemented

**Location:** `types.ts:124`, `script-executor.ts`

`maxMemory` is in the Permissions type but never used. No memory limit is applied to child processes.

**Fix:** Use `resourceLimits` in Node's `child_process.spawn` options (where supported) or document as future work.

#### I-4: Manifest Cache Never Invalidated on File Change

**Location:** `lavs.ts:39`, `lavs.ts:90-106`

Manifest is cached indefinitely. If `lavs.json` is edited on disk, the server continues using the old manifest until `POST .../lavs-cache/clear` is called.

**Fix:** Add file watcher or TTL-based cache invalidation. Document cache behavior.

### 2.3 Nice-to-Have

- **Audit Logging:** Spec mentions "All operations logged"; implementation logs to console but has no structured audit trail for security review.
- **Rate Limit Bypass:** Rate limit is per `agentId:endpointId`. A malicious client could spread load across endpoints.

---

## 3. Performance

### 3.1 Script Handler Startup Cost

**Location:** `script-executor.ts:47-52`

Each request spawns a new process. For `node scripts/todo-service.js list`, this incurs:
- Process creation
- Node.js startup
- Module loading

**Impact:** Cold start can be 100–500ms per call.

**Improvement Proposals:**
1. **Long-Running Daemon:** Support a `daemon` handler type that keeps a process alive and communicates via stdin/stdout or a socket.
2. **Process Pool:** Reuse a pool of pre-spawned workers for hot endpoints.
3. **Document:** Add performance notes to the spec (Section 10.3 mentions this but implementation has no mitigation).

### 3.2 Caching

**Location:** `lavs.ts:39`, `validator.ts:154-178`

- Manifest: Cached in memory.
- Validators: Cached per endpoint.
- **No response caching** for query endpoints. Every `listTodos` call hits the script.

**Improvement:** Add optional `cache` in endpoint schema:

```json
{
  "id": "listTodos",
  "method": "query",
  "handler": { ... },
  "cache": { "ttl": 5000 }
}
```

### 3.3 Connection Pooling

**Location:** `client.ts`

Each `call()` creates a new `fetch`. For subscriptions, each subscriber holds an SSE connection. No connection pooling is needed for HTTP, but:
- **SSE connections:** 100 max per `SubscriptionManager`. Under load, new subscribers may be rejected.
- **No backpressure:** If a script blocks, the HTTP connection stays open; no queue.

---

## 4. Developer Experience

### 4.1 Creating a New LAVS Service

**Current Flow:**
1. Create `lavs.json` manifest
2. Write handler scripts/functions
3. (Optional) Create view component
4. Place in `agents/<agentId>/`

**Gaps:**
- **No CLI/Scaffold:** No `lavs init` or template generator.
- **No Schema Validation for Manifest:** Loader validates structure but not against a JSON Schema. Typos in handler types (e.g., `script` vs `scripts`) fail at runtime.
- **No Dev Server:** No hot-reload when `lavs.json` or scripts change.
- **Inline Component Danger:** `inline` type runs arbitrary code; no sandbox. Easy to shoot oneself in the foot.

### 4.2 Missing Tooling

| Tool | Status |
|------|--------|
| Manifest schema (JSON Schema) | ❌ Not provided |
| `lavs validate` CLI | ❌ |
| `lavs dev` with hot reload | ❌ |
| View component template | ❌ |
| OpenAPI/Swagger from manifest | ❌ |

### 4.3 LAVSClient API Gaps

**Location:** `client.ts`

- `subscribe()` is **not implemented**. The spec's `LAVSClient` interface includes `subscribe(endpoint, callback)`, but the frontend client only has `call()` and `getManifest()`.
- `readFile()` is in the spec but not implemented.

```typescript
// Spec LAVS-SPEC.md:469-472
readFile(path: string): Promise<string>;
```

---

## 5. Scalability

### 5.1 Beyond Local Agents

**Current:** LAVS is designed for local agents. `getAgentDirectory()` resolves to local filesystem paths.

**Multi-Agent Scenarios:**
- **Same Process:** Multiple agents can run; each has its own manifest. ✅
- **Different Processes:** Would need a registry or service discovery. ❌ Not in spec.
- **Remote Agents:** Would require authentication, different base URL. Client supports `baseURL` but there is no standard for remote LAVS discovery.

### 5.2 Subscription Scaling

**Location:** `subscription-manager.ts:54-55`

```typescript
this.maxSubscriptions = options.maxSubscriptions ?? 100;
```

With multiple agents and endpoints, 100 total subscriptions across the entire server may be insufficient. No per-agent or per-endpoint limits.

---

## 6. Interoperability

### 6.1 MCP Integration

**Location:** `lavs-sdk-mcp.ts`, `tool-generator.ts`

- **Tool Generation:** LAVS endpoints are exposed as Claude SDK tools via an in-process MCP server. ✅
- **MCP Handler:** Manifest supports `type: 'mcp'` handler, but it returns 501. LAVS cannot yet proxy to external MCP tools.

```typescript
// lavs.ts:298-306
case 'http':
case 'mcp':
  return res.status(501).json({
    error: { code: -32601, message: `Handler type '${endpoint.handler.type}' not yet implemented` },
  });
```

**Gap:** LAVS can *be* called by MCP (as tools), but LAVS endpoints cannot *call* MCP tools. Bidirectional integration is incomplete.

### 6.2 A2A Integration

**Spec (Section 9.2):** "LAVS services can be called by other agents via A2A."

**Reality:** No A2A-specific adapter exists. LAVS is HTTP-based; an A2A client would need to translate A2A protocol to LAVS HTTP calls. No implementation or documentation for this.

### 6.3 OpenAI Function Calling

LAVS tools are generated for Claude SDK. The schema format (`input_schema` with `properties`, `required`) is similar to OpenAI function calling. A thin adapter could expose LAVS as OpenAI tools, but none exists.

---

## 7. View Component

### 7.1 iframe + postMessage

**Assessment:** iframe isolation is good for security (separate origin potential, CSP). postMessage is standard for cross-frame communication.

**Limitations:**
1. **No Shared Context:** View cannot access parent's React state, router, or theme without explicit postMessage protocol.
2. **Bidirectional Call Complexity:** The container sets up a `handleMessage` for `lavs-call` but this is **inside the load handler** and only for the initial iframe. The iframe must know to send `lavs-call` and expect `lavs-result`/`lavs-error`. This is undocumented in the spec.
3. **CDN/Inline Components:** CDN loads a script into the parent document, not an iframe. So CDN and inline components run in the parent context—different security model than local (iframe).
4. **postMessage Protocol Undefined:** The spec does not document the `lavs-call`, `lavs-result`, `lavs-error`, `lavs-agent-action` message formats. These are implementation details.

### 7.2 Improvement Proposals

1. **Document postMessage Protocol:** Add a "View ↔ Container Protocol" section to the spec.
2. **Unify Loading:** Consider loading all view types in iframes for consistent isolation.
3. **Fallback Rendering:** `fallback: 'list' | 'table' | 'json'` is in the manifest but not implemented. When view load fails, no fallback is shown.

---

## 8. State Management (AI ↔ UI Sync)

### 8.1 Current Mechanism

```
AI executes tool (e.g., lavs_addTodo)
  → useAIStreamHandler processes tool_result
  → notifyToolExecution(toolName) updates store
  → LAVSViewContainer subscribes to lastToolExecution
  → postMessage to iframe: { type: 'lavs-agent-action', action: { type: 'tool_executed', tool } }
  → View's onAgentAction() decides whether to refresh
```

### 8.2 Gaps and Risks

#### R-1: No Tool Result Payload

**Location:** `useAgentStore.ts:127`, `LAVSViewContainer.tsx:144-151`

```typescript
lastToolExecution: { toolName: string; timestamp: number } | null;
// ...
action: { type: 'tool_executed', tool: lastToolExecution.toolName, timestamp }
```

The **result** of the tool (e.g., the new todo object) is not passed. The view must call `listTodos` again to get fresh data. This causes:
- Extra round trip
- Race conditions if mutation and list are not atomic
- Potential stale data if another client mutated in between

**Fix:** Include `toolResult` in `lastToolExecution` and pass it in the postMessage. The view can optimistically update without refetching.

#### R-2: lastToolExecution Overwrite

**Location:** `useAgentStore.ts:510-511`

```typescript
notifyToolExecution: (toolName) => set({
  lastToolExecution: { toolName, timestamp: Date.now() }
}),
```

Rapid successive tool executions overwrite `lastToolExecution`. A view that processes events asynchronously might miss one if two tools complete in quick succession.

**Fix:** Use a queue or append-only log of tool executions, or include a sequence number.

#### R-3: Subscription vs. Tool Notification Redundancy

Mutations trigger both:
1. `subscriptionManager.publishToAgent(agentId, { type: '${endpointId}:mutated', data: result })`
2. `notifyToolExecution` when the AI calls the tool

For AI-driven mutations, the view gets:
- SSE event `addTodo:mutated` (if subscribed)
- postMessage `lavs-agent-action` with `tool_executed`

But the subscription handler is only set up when the view explicitly calls `client.subscribe()`, which is **not implemented** in the client. So in practice, only the postMessage path works. The subscription path is dead for the frontend.

**Fix:** Implement `subscribe()` in LAVSClient to open SSE connection and forward events. Then the view can choose subscription OR tool notification (or both).

#### R-4: No Correlation Between Tool and Endpoint

`lavs_addTodo` maps to endpoint `addTodo`, but the mapping is implicit (prefix `lavs_`). If an agent has multiple LAVS services or the naming changes, the view cannot reliably know which endpoint was called.

**Fix:** Include `endpointId` in the notification, or define a clear naming convention in the spec.

---

## 9. Error Handling

### 9.1 Strengths

- LAVSError with codes
- Validator throws on invalid input
- Script executor captures stdout/stderr on non-zero exit
- Routes map error codes to HTTP status

### 9.2 Gaps

#### E-1: Timeout Race in captureOutput

**Location:** `script-executor.ts:316-338`

```typescript
proc.on('exit', (code) => {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  resolve({ stdout, stderr, exitCode: code || 0 });
});
// ...
setTimeout(() => {
  proc.kill('SIGTERM');
  setTimeout(() => proc.kill('SIGKILL'), 5000);
  reject(new LAVSError(...));
}, timeout);
```

If the timeout fires, `reject` is called but `proc.on('exit')` may also fire later. The promise is already rejected, so no leak, but the process might linger. The 5-second SIGKILL delay is good.

#### E-2: No Retry Semantics

Client has no retry logic. Transient network errors fail immediately.

#### E-3: Partial JSON Extraction

**Location:** `script-executor.ts:361-368`

```typescript
const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
```

Greedy match can capture wrong boundaries if output contains multiple JSON objects. E.g., `{"a":1} {"b":2}` would match from first `{` to last `}`.

#### E-4: Function Executor Timeout Does Not Cancel

**Location:** `function-executor.ts:97-115`

`setTimeout` rejects the promise, but the function continues running. No `AbortController` or similar to actually stop execution.

---

## 10. Testing

### 10.1 Current State

- No dedicated LAVS test suite found in the worktree.
- Validator, loader, permission-checker are unit-testable.
- Script/function executors require integration tests with real scripts.
- Routes require HTTP integration tests.
- Frontend client and LAVSViewContainer require component/browser tests.

### 10.2 Missing Infrastructure

| Need | Status |
|------|--------|
| Fixture lavs.json manifests | ❌ |
| Mock LAVS server | ❌ |
| E2E test for full flow (AI → tool → view update) | ❌ |
| postMessage protocol tests | ❌ |
| Snapshot tests for error formats | ❌ |

### 10.3 Recommendations

1. Add `backend/src/lavs/__tests__/` with unit tests for loader, validator, permission-checker, script-executor (with fixture scripts).
2. Add route integration tests using supertest.
3. Add a mock LAVS server for frontend tests.
4. Document testing strategy in CLAUDE.md.

---

## 11. Versioning & Evolution

### 11.1 Current State

- Spec has `lavs: "1.0"` in manifest.
- No `Accept-Version` or similar header.
- No deprecation policy.
- Changelog exists in spec but is minimal.

### 11.2 Gaps

- **Breaking Changes:** If handler types change (e.g., `input` options), old manifests would break. No migration path.
- **Client Version Negotiation:** Client does not send protocol version. Server cannot adapt.
- **Backward Compatibility:** Adding new optional manifest fields is safe; changing semantics of existing fields is not documented.

### 11.3 Recommendations

1. Add `lavs` version to API responses.
2. Define a versioning policy: semver for manifest, compatibility window for protocol.
3. Consider `X-LAVS-Version` header for client-server negotiation.

---

## 12. Future Extensions (from Spec Section 10.4)

| Extension | Spec | Implementation | Priority |
|-----------|------|----------------|----------|
| Streaming responses | Mentioned | ❌ | High – for large datasets |
| Transactions | Mentioned | ❌ | Medium |
| Middleware | Mentioned | ❌ | Medium – validation/transformation hooks |
| Service discovery | Mentioned | ❌ | Low for local, High for multi-agent |

### Streaming Responses

**Gap:** Large `listTodos` results are returned in one JSON blob. No chunked or NDJSON streaming.

**Proposal:** Add `stream: true` to endpoint schema. When set, handler stdout is streamed as NDJSON. Client would need a streaming `call()` variant.

### Transactions

**Gap:** No way to group multiple mutations atomically. E.g., "add todo + update count" cannot be rolled back if the second fails.

**Proposal:** Add `lavs/transaction` method that accepts an array of `{ endpoint, input }` and executes in order with rollback on failure. Requires handlers to support compensation (complex).

### Middleware

**Gap:** No hooks for pre/post validation, logging, or transformation.

**Proposal:** Add `middleware` array in manifest:

```json
"middleware": [
  { "type": "log", "level": "debug" },
  { "type": "transform", "input": "..." }
]
```

---

## 13. Comparison with Similar Protocols

| Aspect | LAVS | MCP | A2A | OpenAI Function Calling |
|--------|------|-----|-----|-------------------------|
| **Purpose** | Agent ↔ UI, local data | Agent ↔ Tools | Agent ↔ Agent | LLM ↔ Functions |
| **Transport** | HTTP, SSE | stdio, HTTP, SSE | HTTP, WebSocket | In-process (API-dependent) |
| **Schema** | JSON Schema | JSON Schema (tools) | A2A spec | JSON Schema |
| **Discovery** | Manifest file | Config file | Registry (optional) | API-defined |
| **UI Focus** | Yes (view components) | Limited (MCP UI) | No | No |
| **Local Execution** | Scripts, functions | Depends on server | N/A | N/A |
| **Streaming** | Subscriptions (SSE) | Yes (SSE) | Yes | Yes (depends on API) |
| **Batching** | No | No | Yes (implicit) | No |

**LAVS Differentiators:**
- Explicit view component contract
- Manifest-driven, file-based
- Local script/function execution with permissions
- AI ↔ UI sync via store + postMessage

**LAVS Gaps vs. MCP:**
- MCP has richer tool semantics (resources, prompts)
- MCP has stdio transport for local servers
- LAVS has UI binding; MCP does not

---

## 14. Issue Summary by Severity

### Critical (Must Fix)

| ID | Issue | Location |
|----|-------|----------|
| C-1 | postMessage with `'*'` origin | LAVSViewContainer.tsx |
| C-2 | Inline script injection risk | lavs.ts |
| C-3 | CSP `unsafe-inline` | lavs.ts |
| C-4 | Publish endpoint unauthenticated | lavs.ts |

### Important (Should Fix)

| ID | Issue | Location |
|----|-------|----------|
| I-1 | fileAccess not enforced at runtime | permission-checker, script-executor |
| I-2 | networkAccess not enforced | permission-checker |
| I-3 | maxMemory not implemented | script-executor |
| I-4 | Manifest cache never invalidated | lavs.ts |
| R-1 | No tool result in sync payload | useAgentStore, LAVSViewContainer |
| R-2 | lastToolExecution overwrite on rapid calls | useAgentStore |

### Nice-to-Have

| ID | Issue |
|----|-------|
| N-1 | No CLI/scaffold |
| N-2 | subscribe() not implemented in client |
| N-3 | readFile() not implemented |
| N-4 | Fallback view (list/table/json) not implemented |
| N-5 | Response caching for queries |
| N-6 | Batch JSON-RPC support |

---

## 15. Recommended Action Plan

### Phase 1: Security Hardening (1–2 weeks)
1. Fix postMessage origin (C-1)
2. Harden script injection (C-2)
3. Restrict CSP or use nonces (C-3)
4. Add auth to publish endpoint (C-4)

### Phase 2: State Sync & Client Completeness (1 week)
1. Add toolResult to lastToolExecution (R-1)
2. Implement subscribe() in LAVSClient (R-3)
3. Document postMessage protocol

### Phase 3: Spec-Implementation Alignment (1 week)
1. Document REST vs. JSON-RPC dual transport
2. Align subscription format with spec (or update spec for SSE)
3. Implement HTTP handler (or document as future)

### Phase 4: Developer Experience (2 weeks)
1. Add manifest JSON Schema
2. Create `lavs init` scaffold
3. Add cache invalidation (file watcher or TTL)

### Phase 5: Testing (Ongoing)
1. Unit tests for core modules
2. Integration tests for routes
3. E2E test for AI → tool → view flow

---

## Appendix: File Reference Index

| File | Purpose |
|------|---------|
| `docs/LAVS-SPEC.md` | Protocol specification |
| `backend/src/lavs/types.ts` | Core types |
| `backend/src/lavs/loader.ts` | Manifest loading |
| `backend/src/lavs/script-executor.ts` | Script handler execution |
| `backend/src/lavs/function-executor.ts` | Function handler execution |
| `backend/src/lavs/tool-generator.ts` | AI tool generation |
| `backend/src/lavs/lavs-sdk-mcp.ts` | MCP integration |
| `backend/src/lavs/subscription-manager.ts` | SSE subscriptions |
| `backend/src/lavs/validator.ts` | Schema validation |
| `backend/src/lavs/permission-checker.ts` | Permission enforcement |
| `backend/src/lavs/rate-limiter.ts` | Rate limiting |
| `backend/src/routes/lavs.ts` | API routes |
| `frontend/src/lavs/client.ts` | LAVS client SDK |
| `frontend/src/lavs/types.ts` | Frontend types |
| `frontend/src/components/LAVSViewContainer.tsx` | View container |
| `frontend/src/hooks/useAgentLAVS.ts` | LAVS availability hook |
