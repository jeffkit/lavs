# LAVS View Dispatch Protocol — Design Draft

> Status: **Draft (proposal, not yet spec)** — partly superseded by SPEC §11  
> Date: 2026-07-16 (original) · 2026-07-29 (CLI-first repositioning note)  
> Authors: LAVS  
> Related: `docs/SPEC.md` §11 (normative), `docs/PROTOCOL-ANALYSIS.md`

> **⚠️ Note (2026-07-29):** This draft was written when LAVS targeted
> AgentStudio-style **conversational hosts**. Its core concepts (content-type
> as primary abstraction, view bundle portability, two host modes) were adopted
> into SPEC §11 and **remain valid**. However, two parts assumed a conversational
> container that the current CLI-first standalone host does not have:
>
> 1. **Artifact dispatch** (§4.1 trigger #2, §4.2 envelope) — the "agent emits
>    a typed artifact in chat" path. The standalone host has no "chat"; CLI/MCP
>    calls are tool-result dispatch (§4.1 trigger #1), which is the only
>    normative v1.1 path. Artifact dispatch is retained as a future extension.
> 2. **Per-`(conversationId, contentType)` data scoping** (§4.5) — there is no
>    `conversationId` in CLI-first mode. Data scoping is **per-bundle**
>    (`<bundleDir>/data/`), matching the existing implementation.
>
> The body below is preserved as historical design record. For normative
> behavior, see `docs/SPEC.md` §11.

This document proposes the one protocol piece that LAVS v1.0 is missing and
that determines whether general-purpose desktop agents can adopt LAVS: a
**view dispatch protocol** — how a host renders the right LAVS view for a
given piece of structured data inside a single conversation that may span
many domains.

It also records the repositioning that motivates it. Nothing here is
specification yet; it is a design proposal for review before any change to
`SPEC.md` or `schema/`.

---

## 1. Why this exists

LAVS v1.0 assumes **one agent = one LAVS = one view** (CLAUDE.md design
decision #5). That assumption came from AgentStudio's "scenario agent"
model, where each agent is built for one function and owns one data view.

The market reality is different: most desktop agents (Claude Desktop, Cursor,
workbuddy, …) are **general chat agents** — pick a work directory, open one
chat, do many different scenarios in the *same* conversation. Under that
shape, "one agent = one view" has no premise. A user will manage todos, take
notes, and track a budget in one thread.

The fix is not to abandon the scenario-agent case (enterprise function-bound
agents are real). The fix is to change the **primary abstraction** so that
both shapes are first-class host modes of one protocol.

---

## 2. Repositioning (summary)

| | v1.0 framing | Proposed framing |
|---|---|---|
| Primary abstraction | An **agent**'s face | A **content-type**'s view bundle |
| What a manifest binds to | An agent | A type of structured data |
| Views per conversation | Exactly one | Many, dispatched by content-type |
| "Scenario agent" | The only mode | A clean special case (pinned single-view host) |
| Adoption customer | The agent | The **host** (agent-agnostic) |

A LAVS manifest is reinterpreted as a **view bundle**: a content-type
identifier + a renderer (view component) + the data operations (endpoints)
for that type's data + permissions. A view bundle is portable across agents
and scenarios — the same "todo-list" bundle renders wherever a todo-list
artifact appears.

The protocol's primary unit becomes the **content-type**, not the agent.
This is the asymmetry that matters: data-type-as-primary cleanly subsumes
the scenario agent (a host that pins one bundle); agent-as-primary cannot
grow multi-view without becoming a patch.

---

## 3. Concepts

- **View Bundle** — one `lavs.json` manifest: a content-type, its view
  component, its endpoints, its types, its permissions. Portable unit.
- **Content-Type** — the identifier a host matches an artifact against.
  Carried by the manifest's `contentType` (falls back to `name`).
- **Artifact** — a piece of structured data the agent produces that the host
  should render with a view bundle. Carried in an **artifact envelope**.
- **View Registry** — the host's map of `content-type → view bundle`. The
  host loads bundles (local dir or, future, remote) and builds this map.
- **Host Mode** — how a host uses the registry:
  - **pinned** — load exactly one bundle; agent operates within that one
    content-type. Equivalent to v1.0 AgentStudio behavior. UX = "the face".
  - **dispatch** — load a registry; agent emits typed artifacts; host renders
    the matching view for each. Multiple views per conversation.
- **Data Scope** — the isolated data directory a bundle's endpoints operate
  on, keyed by `(conversationId, contentType)` in dispatch mode (or just the
  agent dir in pinned mode).

---

## 4. The dispatch protocol

### 4.1 Two dispatch triggers

A host renders a view in two situations. Both resolve to the same view
bundle; they differ in how the content-type is discovered.

1. **Tool-result dispatch.** The agent calls a LAVS endpoint tool
   (`lavs_<endpoint>`). The host already knows which bundle the tool belongs
   to (by the tool's owning manifest). It renders that bundle's view with the
   tool result. No envelope needed — content-type is implied by the tool.

2. **Artifact dispatch.** The agent emits a structured artifact in chat
   (not via a LAVS op). The host reads the artifact's `contentType`, looks
   up the registry, and renders the matching view. Requires the envelope
   below.

### 4.2 Artifact envelope

A typed artifact the agent/host exchange. Minimal, JSON-RPC-friendly:

```typescript
interface LAVSArtifact {
  lavs: '1.0';
  contentType: string;        // matches a bundle's contentType (or name)
  title?: string;              // human label for the view tab/panel
  data?: any;                  // initial payload for the view (optional)
  init?: {                     // optional: endpoint calls to bootstrap the view
    endpoint: string;          //   e.g. "listTodos"
    input?: any;
  };
  view?: {                     // optional per-artifact overrides
    fallback?: 'list' | 'table' | 'json';
    theme?: Record<string, string>;
  };
}
```

- `data` is for one-shot rendering (artifact-as-preview).
- `init` is for interactive bundles: the view mounts and calls `init.endpoint`
  to load live data, then subscribes for updates. Use one or the other.
- The envelope carries **no** `instanceId` in v1 of dispatch (see §4.5).

### 4.3 View registry

The host discovers bundles and builds `contentType → bundle`.

**Local registry** (v1): a directory of bundle folders, each with a
`lavs.json` (+ view component + scripts):

```
<registry-dir>/
├── todo-list/
│   ├── lavs.json            # contentType: "lavs/todo-list"
│   ├── view/index.html
│   └── scripts/
├── daily-note/
│   ├── lavs.json            # contentType: "lavs/daily-note"
│   └── view/index.html
└── budget/
    └── lavs.json
```

- Pinned mode: registry contains one bundle (or the host is pointed at one
  `lavs.json` directly). `contentType` is still declared but unused for
  dispatch.
- Dispatch mode: host loads every `lavs.json`, indexes by `contentType`.
- Duplicate `contentType` across bundles is a load-time error.
- Remote registry / discovery is explicitly out of scope for v1 (see §7).

### 4.4 Dispatch algorithm (host-side)

```
on typed artifact A (or tool result from bundle B):
  ct = A.contentType          // or B's contentType for tool-result dispatch
  bundle = registry[ct]
  if !bundle:
      render fallback (list|table|json) or skip         // §6
      return
  scope = dataScope(conversationId, ct)                 // §4.5
  iframe = mount bundle.view.component in sandboxed iframe
  inject LAVSClient bound to (bundle, scope)             // routes lavs-call
  if A.init: view calls A.init.endpoint to bootstrap
  else if A.data: view renders A.data directly
  // SSE subscriptions from bundle endpoints are forwarded into the iframe
```

The container routes every `lavs-call` from that iframe to the **bound
bundle's** endpoints, scoped to `scope`. The container routes
`lavs-agent-action` notifications into the iframe only when the action's
`contentType` matches the iframe's bound bundle (see §5.2).

### 4.5 Data scope and isolation

- Pinned mode: `scope = <agentDir>/data` (v1.0 behavior, unchanged).
- Dispatch mode: `scope = <registryDir>/<bundleDir>/data/<conversationId>/`.
  Each `(conversation, contentType)` pair gets an isolated directory.
  `permissions.fileAccess` globs resolve against `scope`.

This is the main extension to v1.0's single-dir permission model: the
permission checker resolves file globs relative to the per-conversation
scope, not a single project path.

### 4.6 Instance scoping (deferred)

v1 of dispatch keys data by `(conversationId, contentType)` — one data
store per content-type per conversation. Multiple artifacts of the *same*
content-type in one conversation share that store. This covers the common
case (one todo list, one note, one budget per thread).

Multiple *instances* of the same content-type in one conversation (two
independent todo lists) is deferred. The envelope reserves no `instanceId`
field yet; if needed later it is added as optional and endpoints opt in to
receiving it. Keeping v1 without it avoids forcing every endpoint to thread
an instance key.

---

## 5. Interaction with existing v1.0

### 5.1 What stays unchanged

- Manifest structure (`endpoints`, `handler`, `schema`, `types`,
  `permissions`, `view.component` sources).
- Handler types and executors (script / function / http / mcp).
- JSON-RPC 2.0 envelope, REST routes, SSE subscriptions.
- The reverse MCP bridge (`lavs-runtime serve`) — still exposes each
  bundle's query/mutation endpoints as `lavs_<endpoint>` tools.
- The postMessage bridge messages (`lavs-call`, `lavs-result`,
  `lavs-error`, `lavs-agent-action`).

### 5.2 What extends

- `lavs-agent-action` gains a `contentType` field so a container with
  multiple mounted views can route the notification to the right iframe
  instead of broadcasting to all.

```typescript
{
  type: 'lavs-agent-action',
  action: {
    type: 'tool_executed',
    tool: 'lavs_addTodo',
    contentType: 'lavs/todo-list',   // NEW
    timestamp: number,
    result?: any                    // also recommended: R-1 from PROTOCOL-ANALYSIS
  }
}
```

- The `LAVSClient` is constructed per-iframe and bound to a specific bundle
  + scope, so `call(endpoint, input)` routes to the right manifest. No API
  change, just construction-time binding.
- `getManifest()` returns the bound bundle's manifest.

### 5.3 Manifest schema changes (minimal, backward-compatible)

One new optional field:

```json
{
  "lavs": "1.0",
  "name": "todo-manager",
  "contentType": "lavs/todo-list",   // NEW, optional; defaults to `name`
  "version": "1.0.0",
  "endpoints": [ ... ],
  "view": { ... }
}
```

- `name` stays the bundle/service id (used for tool naming, MCP server name,
  directory naming). Unchanged semantics, unchanged pattern.
- `contentType` is the dispatch key. When absent, it defaults to `name`, so
  every existing v1.0 manifest is a valid v1.1 manifest with
  `contentType = name`.
- Recommended `contentType` form: a namespaced string (`lavs/todo-list`,
  `dev.acme.budget`) to avoid collisions across publishers. `name` may stay
  short and service-like.

No required field is added; no existing field's meaning changes. This is a
1.0 → 1.1 additive bump.

---

## 6. Fallback rendering

`view.fallback` (`list` | `table` | `json`) is declared in v1.0 but not
implemented. Dispatch makes it load-bearing: when no bundle matches a
content-type, or a bundle's view component fails to load, the host MUST
fall back. This closes PROTOCOL-ANALYSIS gap N-4 and is a prerequisite for
dispatch.

- No bundle for `contentType` → render `json` fallback of the artifact data
  with a "no view installed" affordance.
- Bundle exists but component fails → use the bundle's declared `fallback`
  (default `table`) over the last known data.

---

## 7. Out of scope (v1 of dispatch)

- Remote / network view registries and service discovery.
- Multi-instance scoping (§4.6).
- Cross-conversation data sharing.
- Signing / provenance of view bundles (see §8 security note).
- Streaming / batch / transactions (orthogonal; see PROTOCOL-ANALYSIS §12).

---

## 8. Security notes

Dispatch multiplies the attack surface: a host now loads many bundles and
renders many views in one conversation. Two consequences:

1. **ADVISORY permissions become more dangerous.** v1.0 already admits
   `fileAccess` / `networkAccess` / `maxMemory` are not OS-enforced. With
   many bundles mounted, a single malicious bundle can read across scopes if
   no sandbox backs the permission model. Dispatch mode should require (or
   strongly recommend) OS-level sandboxing (Docker / nsjail / platform
   sandbox) before loading untrusted bundles. The registry loader should
   refuse to mount bundles whose `fileAccess` globs escape their own scope.

2. **Per-scope isolation must be enforced at the executor.** The script/http
   executors must resolve `permissions.fileAccess` against the artifact's
   scope and reject out-of-scope access at dispatch time (not only path
   traversal on `cwd`/`command` as today).

These do not block the design but are implementation prerequisites for
untrusted-bundle dispatch.

---

## 9. Open questions (need decisions before spec)

1. **Tool-result dispatch naming.** When multiple bundles are mounted, the
   reverse-MCP bridge today names tools `lavs_<endpoint>` with no bundle
   qualifier. Two bundles with an endpoint `list` collide. Options:
   (a) `lavs_<bundleName>__<endpoint>`; (b) keep flat and require unique
   endpoint ids across the registry. Leaning (a).
2. **Where does the registry live?** Default `<agentDir>/views/`? A
   user-level `~/.lavs/registry/`? Both with precedence? 
3. **Does the agent pick the content-type, or does the host infer it?** For
   artifact dispatch, should the agent explicitly emit the envelope, or
   should the host infer content-type from the data shape (schema matching)?
   Explicit is simpler and proposed for v1; inference is a possible later
   convenience.
4. **Pinned-mode compatibility check.** Should a pinned host reject
   manifests that declare a `contentType` different from the pinned one, or
   just ignore it?
5. **SSE fan-out across multiple instances of the same bundle's view.** If
   the same content-type is rendered in two conversations, subscriptions
   must not cross conversations. The scope key already prevents this for
   data; confirm the subscription manager keys by scope too.

---

## 10. Proposed rollout

1. Adopt this design (this doc → review).
2. Add `contentType` to manifest schema + types (TS + Python) + `validate`.
3. Implement view registry + dispatch in a reference host (AgentStudio
   dispatch-mode branch), reusing the existing iframe/postMessage bridge.
4. Implement fallback rendering (closes N-4).
5. Extend `lavs-agent-action` with `contentType` + `result` (closes R-1).
6. Update `SPEC.md` to 1.1 with §4–§6 as normative, keep v1.0 behavior as the
   pinned-mode special case.
7. Add a reference bundle (`examples/jarvis-agent/` or a new
   `examples/todo-list/`) wired for dispatch mode, plus a third-party
   adoption guide.

Step 6 is the only spec-breaking (additive) change; steps 2–5 are
implementation that can land first and prove the design.
