# LAVS Specification v1.0

**Local Agent View Service Protocol**

## Abstract

LAVS (Local Agent View Service) is a standard protocol that enables local AI agents to expose structured data interfaces and interact securely with visual UI components. It fills the gap between conversational AI interfaces and visual data manipulation needs in local agent applications.

## Status of This Document

This document is a draft specification for LAVS. Version 1.1 adds the
**View Dispatch Protocol** (multiple views per host session, dispatched by
content-type) as a normative, backward-compatible extension. v1.0 behavior is
preserved as the "pinned" host mode. It is subject to change based on community
feedback and implementation experience.

**Version:** 1.1.0-draft
**Date:** 2026-07-16
**Authors:** AgentStudio Team
**License:** Apache 2.0

## Table of Contents

1. [Introduction](#1-introduction)
2. [Terminology](#2-terminology)
3. [Architecture](#3-architecture)
4. [Manifest Format](#4-manifest-format)
5. [Protocol Specification](#5-protocol-specification)
6. [Security Model](#6-security-model)
7. [View Component Interface](#7-view-component-interface)
8. [Examples](#8-examples)
9. [Interoperability](#9-interoperability)
10. [Appendix](#10-appendix)
11. [View Dispatch Protocol (v1.1)](#11-view-dispatch-protocol-v11)

---

## 1. Introduction

### 1.1 Motivation

Modern AI agent applications often require:
- **Conversational interface** for natural language interaction
- **Visual interface** for structured data manipulation
- **Bidirectional data flow** between AI and human users
- **Local data persistence** with various storage backends

Existing protocols address specific aspects:
- **MCP (Model Context Protocol)**: Agent ↔ External tools
- **A2A (Agent-to-Agent)**: Agent ↔ Agent communication
- **MCP UI**: Tool parameter input forms

However, none provide a standard way for local agents to:
1. Expose structured data operations to visual frontends
2. Execute local scripts/services safely
3. Maintain synchronized state between AI and UI

LAVS addresses this gap.

#### 1.1.1 Primary abstraction (v1.1)

A LAVS manifest binds to a **content-type** (a type of structured data), not
to an agent. A manifest is a **view bundle**: a content-type identifier + a
renderer (view component) + the data operations (endpoints) for that type's
data + permissions. A view bundle is portable across agents and scenarios.

A host uses the registry in one of two first-class **host modes**:

- **pinned** — load exactly one bundle; the agent operates within one
  content-type. Equivalent to v1.0 behavior. UX = the agent's "face".
- **dispatch** — load a registry of bundles; the agent emits typed artifacts;
  the host renders the matching view for each. Multiple views per conversation.

The scenario/function-bound agent (e.g. an enterprise agent per职能) is the
pinned mode; the general chat agent (Claude Desktop, Cursor, workbuddy, …) is
the dispatch mode. Both are first-class. See §11 for the dispatch protocol.

### 1.2 Design Goals

1. **Declarative**: Interfaces defined in JSON manifest
2. **Language-agnostic**: Works with any scripting language
3. **Secure**: Permission-based access control and sandboxing
4. **Framework-independent**: Frontend can use any UI framework
5. **Composable**: Works alongside MCP, A2A, and other protocols
6. **Developer-friendly**: Minimal boilerplate, clear contracts

### 1.3 Use Cases

- **Task Management**: AI conversation + Kanban board UI
- **Note-Taking**: AI organization + Rich text editor
- **Data Analysis**: AI insights + Chart visualizations
- **Code Assistance**: AI generation + Code editor
- **Personal Finance**: AI bookkeeping + Dashboard

---

## 2. Terminology

- **LAVS Service**: A service that implements the LAVS protocol
- **Manifest**: JSON file (`lavs.json`) defining service interfaces
- **Endpoint**: A callable operation exposed by the service
- **Handler**: Backend script/function that implements an endpoint
- **View Component**: Frontend UI component that consumes the service
- **Runtime**: Software that executes LAVS services
- **Client**: Software that calls LAVS endpoints (frontend or agent)
- **Content-Type** (v1.1): The identifier a host dispatches on. Carried by a
  manifest's `contentType` (defaults to `name`).
- **View Bundle** (v1.1): A manifest interpreted as a content-type + renderer +
  data operations + permissions. The portable unit across agents/scenarios.
- **Artifact** (v1.1): A piece of structured data the agent produces that the
  host renders with a view bundle. Carried in an artifact envelope (§11.2).
- **View Registry** (v1.1): The host's map of `content-type → view bundle`.
- **Host Mode** (v1.1): How a host uses the registry — `pinned` (one bundle)
  or `dispatch` (many bundles, dispatched per artifact).
- **Data Scope** (v1.1): The isolated data directory a bundle's endpoints
  operate on, keyed by `(conversationId, contentType)` in dispatch mode.

---

## 3. Architecture

### 3.1 System Overview

```
┌─────────────────────────────────────────────────┐
│              Agent Application                   │
│                                                  │
│  ┌──────────────┐         ┌──────────────┐     │
│  │   Chat UI    │         │  Visual UI   │     │
│  │  (Dialogue)  │         │ (LAVS View)  │     │
│  └──────┬───────┘         └──────┬───────┘     │
│         │                        │              │
│         │   ┌────────────────────┘              │
│         │   │                                   │
│         ▼   ▼                                   │
│    ┌─────────────┐                             │
│    │   Agent     │                             │
│    │   Runtime   │                             │
│    └──────┬──────┘                             │
│           │                                     │
└───────────┼─────────────────────────────────────┘
            │
            ▼
   ┌─────────────────┐
   │  LAVS Runtime   │◄──── lavs.json
   └────────┬────────┘
            │
      ┌─────┴─────┬──────────┬──────────┐
      ▼           ▼          ▼          ▼
   Script    Function     HTTP      Database
   Handler    Handler    Proxy      Adapter
```

### 3.2 Communication Flow

```
Frontend Component
    │
    │ 1. Call endpoint
    ├──────────────────────────► LAVS Runtime
    │                                  │
    │                                  │ 2. Validate permissions
    │                                  │ 3. Resolve handler
    │                                  │
    │                                  ▼
    │                            Execute Handler
    │                            (script/function)
    │                                  │
    │ 4. Return result                 │
    │◄─────────────────────────────────┘
    │
    │ 5. Update UI
    ▼
```

### 3.3 Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **Manifest** | Define interfaces, permissions, handlers |
| **Runtime** | Parse manifest, execute handlers, enforce security |
| **Handler** | Implement business logic, data operations |
| **View Component** | Render UI, call endpoints via client SDK |
| **Client SDK** | Abstract communication protocol |

---

## 4. Manifest Format

### 4.1 Schema

A LAVS manifest is a JSON file named `lavs.json` with the following structure:

```typescript
interface LAVSManifest {
  lavs: string;              // Protocol version (e.g., "1.0")
  name: string;              // Service / bundle id (tool naming, dir naming)
  contentType?: string;      // Content-type a host dispatches on (v1.1); defaults to `name`
  version: string;           // Service version (semver)
  description?: string;      // Human-readable description

  endpoints: Endpoint[];     // Exposed operations
  view?: ViewConfig;         // Optional UI component
  types?: TypeDefinitions;   // Type definitions
  permissions?: Permissions; // Security constraints
}
```

`contentType` (v1.1) is optional. When absent, it defaults to `name`. A
recommended namespaced form (`lavs/todo-list`, `dev.acme.budget`) avoids
collisions across publishers. Pattern: `^[a-zA-Z][a-zA-Z0-9_./-]*$`. A host
indexes its view registry by `contentType ?? name`.

### 4.2 Endpoint Definition

```typescript
interface Endpoint {
  id: string;                // Unique endpoint identifier
  method: 'query' | 'mutation' | 'subscription';
  description?: string;

  handler: Handler;          // How to execute this endpoint
  schema?: Schema;           // Input/output schema
  permissions?: Permissions; // Endpoint-specific permissions
}
```

#### 4.2.1 Method Types

- **query**: Read-only operations (GET)
- **mutation**: Write operations (POST/PUT/DELETE)
- **subscription**: Real-time updates (WebSocket/SSE)

### 4.3 Handler Types

```typescript
type Handler =
  | ScriptHandler
  | FunctionHandler
  | HTTPHandler
  | MCPHandler;

interface ScriptHandler {
  type: 'script';
  command: string;           // Command to execute
  args?: string[];           // Static arguments
  input?: 'args' | 'stdin' | 'env'; // How to pass parameters
  cwd?: string;              // Working directory
  timeout?: number;          // Max execution time (ms)
  env?: Record<string, string>; // Environment variables
}

interface FunctionHandler {
  type: 'function';
  module: string;            // Path to JS/TS module
  function: string;          // Function name to call
}

interface HTTPHandler {
  type: 'http';
  url: string;               // HTTP endpoint
  method: string;            // HTTP method
  headers?: Record<string, string>;
}

interface MCPHandler {
  type: 'mcp';
  server: string;            // MCP server name
  tool: string;              // MCP tool name
}
```

### 4.4 Schema Definition

Uses JSON Schema format:

```typescript
interface Schema {
  input?: JSONSchema;        // Input parameters schema
  output?: JSONSchema;       // Output data schema
}
```

### 4.5 View Configuration

```typescript
interface ViewConfig {
  component: ComponentSource;
  fallback?: 'list' | 'table' | 'json'; // Fallback display mode
  icon?: string;             // Icon identifier
  theme?: Record<string, string>; // Theme variables
}

type ComponentSource =
  | { type: 'cdn'; url: string; exportName?: string }
  | { type: 'npm'; package: string; version?: string }
  | { type: 'local'; path: string }
  | { type: 'inline'; code: string };
```

### 4.6 Permissions

```typescript
interface Permissions {
  fileAccess?: string[];     // Allowed file path patterns
  networkAccess?: boolean | string[]; // Network access control
  maxExecutionTime?: number; // Max handler execution time (ms)
  maxMemory?: number;        // Max memory usage (bytes)
}
```

### 4.7 Complete Example

```json
{
  "lavs": "1.0",
  "name": "todo-manager",
  "version": "1.0.0",
  "description": "Todo management service with AI assistance",

  "endpoints": [
    {
      "id": "listTodos",
      "method": "query",
      "description": "Retrieve all todos",
      "handler": {
        "type": "script",
        "command": "node",
        "args": ["scripts/todo-service.js", "list"],
        "input": "args",
        "timeout": 5000
      },
      "schema": {
        "output": {
          "type": "array",
          "items": { "$ref": "#/types/Todo" }
        }
      }
    },
    {
      "id": "addTodo",
      "method": "mutation",
      "description": "Create a new todo",
      "handler": {
        "type": "script",
        "command": "node",
        "args": ["scripts/todo-service.js", "add"],
        "input": "stdin"
      },
      "schema": {
        "input": {
          "type": "object",
          "properties": {
            "text": { "type": "string" },
            "priority": { "type": "number", "default": 0 }
          },
          "required": ["text"]
        },
        "output": { "$ref": "#/types/Todo" }
      }
    },
    {
      "id": "todoUpdates",
      "method": "subscription",
      "description": "Subscribe to todo changes",
      "handler": {
        "type": "script",
        "command": "node",
        "args": ["scripts/todo-watch.js"]
      }
    }
  ],

  "view": {
    "component": {
      "type": "cdn",
      "url": "https://cdn.example.com/todo-view@1.0.0.js",
      "exportName": "TodoView"
    },
    "fallback": "table",
    "icon": "checklist"
  },

  "types": {
    "Todo": {
      "type": "object",
      "properties": {
        "id": { "type": "number" },
        "text": { "type": "string" },
        "done": { "type": "boolean" },
        "priority": { "type": "number" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["id", "text", "done"]
    }
  },

  "permissions": {
    "fileAccess": ["./data/**/*.json"],
    "networkAccess": false,
    "maxExecutionTime": 30000,
    "maxMemory": 104857600
  }
}
```

---

## 5. Protocol Specification

### 5.1 Transport

LAVS Runtime MUST support:
- **HTTP/HTTPS** for queries and mutations (REST-style URLs)
- **SSE (Server-Sent Events)** for subscriptions

The primary transport uses REST-style URLs for simplicity and debuggability:
- `GET  /api/agents/:agentId/lavs/manifest` — Get manifest
- `POST /api/agents/:agentId/lavs/:endpoint` — Call endpoint
- `GET  /api/agents/:agentId/lavs/:endpoint/subscribe` — SSE subscription

JSON-RPC 2.0 envelope is used for response formatting (see 5.2).

### 5.2 Message Format

LAVS uses JSON-RPC 2.0 envelope for responses over HTTP.

#### 5.2.1 Request

```typescript
interface LAVSRequest {
  jsonrpc: '2.0';
  id: string | number;       // Request ID
  method: string;            // 'lavs/call' | 'lavs/subscribe' | 'lavs/unsubscribe'
  params: {
    endpoint: string;        // Endpoint ID from manifest
    input?: any;             // Input parameters
  };
}
```

**Example:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "lavs/call",
  "params": {
    "endpoint": "addTodo",
    "input": {
      "text": "Buy milk",
      "priority": 1
    }
  }
}
```

#### 5.2.2 Response

```typescript
interface LAVSResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;              // Success result
  error?: LAVSError;         // Error object
}

interface LAVSError {
  code: number;              // Error code
  message: string;           // Error message
  data?: any;                // Additional error data
}
```

**Success Example:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "id": 123,
    "text": "Buy milk",
    "done": false,
    "priority": 1,
    "createdAt": "2025-01-15T10:30:00Z"
  }
}
```

**Error Example:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params: 'text' is required",
    "data": {
      "field": "text",
      "constraint": "required"
    }
  }
}
```

### 5.3 Error Codes

| Code | Message | Description |
|------|---------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid request | Invalid request object |
| -32601 | Method not found | Endpoint does not exist |
| -32602 | Invalid params | Invalid input parameters |
| -32603 | Internal error | Runtime error |
| -32001 | Permission denied | Insufficient permissions |
| -32002 | Timeout | Handler execution timeout |
| -32003 | Handler error | Handler script/function failed |

### 5.4 Subscription Protocol

For `subscription` endpoints, use **Server-Sent Events (SSE)**:

**Subscribe (HTTP GET):**
```
GET /api/agents/:agentId/lavs/:endpoint/subscribe
Accept: text/event-stream
```

The server responds with an SSE stream (`Content-Type: text/event-stream`).

**Connection Established:**
```
event: connected
data: {"subscriptionId":"sub-123","agentId":"jarvis","endpoint":"todoUpdates"}
```

**Data Push (server-initiated):**
```
event: data
data: {"type":"todoAdded","data":{"id":124,"text":"New task"}}
```

**Mutation Auto-Publish:**
When a mutation endpoint executes successfully, the runtime automatically publishes to all active SSE subscribers:
```
event: data
data: {"type":"addTodo:mutated","data":{"id":124,"text":"New task","done":false}}
```

**Unsubscribe:**
The client closes the SSE connection (EventSource.close() or HTTP disconnect). The server cleans up the subscription automatically.

**Heartbeat:**
```
event: heartbeat
data: {"timestamp":"2025-01-15T10:30:00Z"}
```

**Rationale for SSE over WebSocket (ADR-2):**
- SSE works well under HTTP/2
- No WebSocket upgrade complexity
- Browser-native `EventSource` API
- Aligns with AgentStudio's existing SSE infrastructure

---

## 6. Security Model

### 6.1 Principles

1. **Least Privilege**: Services declare minimum required permissions
2. **Sandboxing**: Handlers execute in isolated environments
3. **Validation**: All inputs validated against schemas
4. **Auditing**: All operations logged for review

### 6.2 Permission Enforcement

Runtime MUST enforce permissions declared in manifest:

Permissions have two enforcement levels:

| Permission | Level | Description |
|-----------|-------|-------------|
| Path traversal | **ENFORCED** | Handler cwd/command paths are validated before execution |
| Input validation | **ENFORCED** | JSON Schema validation on all inputs |
| maxExecutionTime | **ENFORCED** | Handler killed via SIGTERM/SIGKILL on timeout |
| fileAccess | **ADVISORY** | Glob patterns checked at dispatch, NOT at OS/syscall level |
| networkAccess | **ADVISORY** | Declared for auditing; not enforced at runtime |
| maxMemory | **ADVISORY** | Not enforced in current runtime |

> **Note**: ADVISORY permissions are declared in the manifest for documentation and auditing purposes. They signal the developer's intent but are not enforced at the OS level. For strict enforcement, use OS-level sandboxing (nsjail, Docker, etc.).

- **fileAccess** (ADVISORY): Glob patterns for accessible files
  - `./data/**/*.json` - Allow JSON files in data directory
  - `!./data/secrets.json` - Explicitly deny specific file

- **networkAccess** (ADVISORY):
  - `false` - No network access (intent)
  - `true` - Allow all network access (discouraged)
  - `["api.example.com"]` - Whitelist specific domains (intent)

- **maxExecutionTime** (ENFORCED): Kill handler if exceeds limit

- **maxMemory** (ADVISORY): Memory limit intent (OS-dependent enforcement)

### 6.3 Input Validation

Runtime MUST validate inputs against schema before execution:

```typescript
// Pseudocode
function validateAndExecute(endpoint, input) {
  if (!validate(input, endpoint.schema.input)) {
    throw new LAVSError(-32602, 'Invalid params');
  }

  const result = executeHandler(endpoint.handler, input);

  if (!validate(result, endpoint.schema.output)) {
    throw new LAVSError(-32603, 'Invalid output from handler');
  }

  return result;
}
```

### 6.4 Sandboxing

Recommended sandbox mechanisms:

- **Script handlers**:
  - Use OS-level process isolation
  - Drop unnecessary capabilities (Linux capabilities)
  - Use containers (Docker, podman) for strict isolation

- **Function handlers**:
  - Run in separate V8 isolate (Node.js)
  - Use `vm2` or similar sandboxing libraries

- **Network isolation**:
  - Use network namespaces or firewall rules
  - Enforce domain whitelists

### 6.5 View Component Security

View components from untrusted sources SHOULD:

1. Load in sandboxed iframe with CSP headers
2. Only access LAVS endpoints (no direct file access)
3. Be served with `Permissions-Policy` restrictions

Example CSP for view component (using nonce for script execution):
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-<random>';
  style-src 'self' 'unsafe-inline';
  connect-src 'self';
  img-src 'self' data: https:;
  frame-ancestors 'self';
```

The runtime generates a cryptographic nonce per request and injects it into the CSP header and any LAVS-injected `<script>` tags. This prevents execution of arbitrary inline scripts while allowing the LAVS config initialization script.

### 6.6 Dispatch Mode (v1.1)

When a host runs in dispatch mode (§11.4) and loads multiple bundles, the
attack surface multiplies. See §11.8 for dispatch-specific security
requirements: OS-level sandboxing for untrusted bundles, per-scope file-access
enforcement at the executor, and scope-keyed SSE fan-out.

---

## 7. View Component Interface

### 7.1 Component Contract

View components MUST implement this interface:

```typescript
interface LAVSViewComponent extends HTMLElement {
  // Called when component is mounted
  connectedCallback(): void;

  // Runtime injects API client
  setLAVSClient(client: LAVSClient): void;

  // Optional: receive notifications from agent
  onAgentAction?(action: AgentAction): void;

  // Called when component is unmounted
  disconnectedCallback(): void;
}
```

### 7.2 Client API

Runtime provides this client to view components:

```typescript
interface LAVSClient {
  // Call an endpoint
  call<T = any>(
    endpoint: string,
    input?: any
  ): Promise<T>;

  // Subscribe to updates
  subscribe(
    endpoint: string,
    callback: (data: any) => void
  ): () => void; // Returns unsubscribe function

  // Get service metadata
  getManifest(): Promise<LAVSManifest>;

  // Read files (if permitted)
  readFile(path: string): Promise<string>;
}
```

### 7.3 Example View Component

```typescript
class TodoView extends HTMLElement implements LAVSViewComponent {
  private client!: LAVSClient;
  private todos: Todo[] = [];

  connectedCallback() {
    this.render();
  }

  setLAVSClient(client: LAVSClient) {
    this.client = client;
    this.init();
  }

  async init() {
    // Load initial data
    this.todos = await this.client.call('listTodos');

    // Subscribe to updates
    this.client.subscribe('todoUpdates', (data) => {
      this.handleUpdate(data);
    });

    this.render();
  }

  async addTodo(text: string) {
    const newTodo = await this.client.call('addTodo', {
      text,
      priority: 1
    });
    this.todos.push(newTodo);
    this.render();
  }

  onAgentAction(action: AgentAction) {
    if (action.type === 'todoAdded') {
      this.todos.push(action.data);
      this.render();
    }
  }

  render() {
    this.innerHTML = `
      <div class="todo-list">
        ${this.todos.map(t => `
          <div class="todo-item">${t.text}</div>
        `).join('')}
      </div>
    `;
  }
}

customElements.define('todo-view', TodoView);
```

### 7.4 View ↔ Container Communication Protocol (postMessage)

When view components are loaded in an iframe, communication between the container (parent page) and the view (iframe) uses the `window.postMessage` API. All messages use `window.location.origin` as the target origin for security.

#### 7.4.1 Message Types

| Direction | Type | Purpose |
|-----------|------|---------|
| View → Container | `lavs-call` | View requests an endpoint call |
| Container → View | `lavs-result` | Container returns call result |
| Container → View | `lavs-error` | Container returns call error |
| Container → View | `lavs-agent-action` | AI agent performed an action |

#### 7.4.2 lavs-call (View → Container)

View sends this when calling a LAVS endpoint:

```typescript
{
  type: 'lavs-call',
  id: string,          // Unique request ID for correlation
  endpoint: string,    // Endpoint ID to call
  input?: any          // Input data for the endpoint
}
```

#### 7.4.3 lavs-result (Container → View)

Container responds with the endpoint result:

```typescript
{
  type: 'lavs-result',
  id: string,          // Matches the lavs-call id
  result: any          // Endpoint result data
}
```

#### 7.4.4 lavs-error (Container → View)

Container responds with an error:

```typescript
{
  type: 'lavs-error',
  id: string,          // Matches the lavs-call id
  error: string        // Error message
}
```

#### 7.4.5 lavs-agent-action (Container → View)

Container notifies the view when the AI agent executes a LAVS tool:

```typescript
{
  type: 'lavs-agent-action',
  action: {
    type: 'tool_executed',
    tool: string,      // Tool name (e.g., 'lavs_addTodo')
    contentType: string, // (v1.1) content-type of the bundle whose tool ran
    timestamp: number, // When the tool was executed
    result?: any       // Tool execution result (for optimistic updates)
  }
}
```

`contentType` (v1.1) lets a container that has multiple views mounted route
the notification to the matching iframe instead of broadcasting to all.
`result` (recommended) lets the view optimistically update without refetching
(closes the "no tool result payload" gap).

The view's `onAgentAction` handler can use this to:
- Refresh data from the endpoint
- Optimistically update the UI using the `result` field
- Ignore irrelevant tool executions

#### 7.4.6 Context Variables

The container injects LAVS context into the iframe via a JSON config element:

```html
<script id="lavs-config" type="application/json">{"agentId":"...","projectPath":"..."}</script>
<script nonce="<random>">
  var cfg = JSON.parse(document.getElementById('lavs-config').textContent);
  window.LAVS_AGENT_ID = cfg.agentId;
  window.LAVS_PROJECT_PATH = cfg.projectPath;
</script>
```

Views can access `window.LAVS_AGENT_ID` and `window.LAVS_PROJECT_PATH` for context.

---

## 8. Examples

### 8.1 Simple File-Based Service

**lavs.json:**
```json
{
  "lavs": "1.0",
  "name": "simple-notes",
  "version": "1.0.0",

  "endpoints": [
    {
      "id": "getNotes",
      "method": "query",
      "handler": {
        "type": "script",
        "command": "cat",
        "args": ["notes.txt"]
      }
    },
    {
      "id": "saveNote",
      "method": "mutation",
      "handler": {
        "type": "script",
        "command": "bash",
        "args": ["-c", "echo \"$NOTE\" >> notes.txt"],
        "input": "env"
      },
      "schema": {
        "input": {
          "type": "object",
          "properties": {
            "NOTE": { "type": "string" }
          }
        }
      }
    }
  ],

  "permissions": {
    "fileAccess": ["notes.txt"]
  }
}
```

### 8.2 Database-Backed Service

**lavs.json:**
```json
{
  "lavs": "1.0",
  "name": "contact-manager",
  "version": "1.0.0",

  "endpoints": [
    {
      "id": "searchContacts",
      "method": "query",
      "handler": {
        "type": "script",
        "command": "python3",
        "args": ["scripts/contacts.py", "search"],
        "input": "stdin"
      },
      "schema": {
        "input": {
          "type": "object",
          "properties": {
            "query": { "type": "string" }
          }
        }
      }
    }
  ],

  "permissions": {
    "fileAccess": ["contacts.db"]
  }
}
```

**scripts/contacts.py:**
```python
import sys
import json
import sqlite3

action = sys.argv[1]
conn = sqlite3.connect('contacts.db')

if action == 'search':
    params = json.load(sys.stdin)
    query = params['query']
    cursor = conn.execute(
        "SELECT * FROM contacts WHERE name LIKE ?",
        (f"%{query}%",)
    )
    results = [dict(row) for row in cursor.fetchall()]
    print(json.dumps(results))
```

### 8.3 MCP Integration

**lavs.json:**
```json
{
  "lavs": "1.0",
  "name": "github-issues",
  "version": "1.0.0",

  "endpoints": [
    {
      "id": "listIssues",
      "method": "query",
      "handler": {
        "type": "mcp",
        "server": "github",
        "tool": "list_issues"
      }
    }
  ]
}
```

The `lavs.json` only *references* an MCP server by name. The connection
details live in a separate `mcp-config.json` colocated with `lavs.json`:

```json
{
  "mcpServers": {
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    },
    "weather": {
      "transport": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer xxx" }
    }
  }
}
```

Transport options:
- `stdio`: spawn a local process (`command` + `args`, optional `env`/`cwd`).
- `http`: connect to a Streamable HTTP MCP endpoint (`url`, optional `headers`).
- Optional `timeout` (ms) caps the connect + call duration.

See `schema/mcp-config.schema.json` for the full schema. The runtime reads
`mcp-config.json` from the same directory as `lavs.json` and resolves
`handler.server` against its `mcpServers` map.

---

## 9. Interoperability

### 9.1 Relationship with MCP

LAVS complements MCP:

- **MCP**: Agent calls external tools/services
- **LAVS**: Agent exposes internal data to UI

They can work together:

```json
{
  "endpoints": [
    {
      "id": "searchGitHub",
      "method": "query",
      "handler": {
        "type": "mcp",
        "server": "github",
        "tool": "search_code"
      }
    }
  ]
}
```

### 9.2 Relationship with A2A

LAVS services can be called by other agents via A2A:

```
Agent A (LAVS) ←─ HTTP ─→ Agent B (A2A client)
```

### 9.3 Standard File Locations

Recommended directory structure:

```
my-agent/
├── lavs.json              # LAVS manifest
├── mcp-config.json        # Optional: MCP servers
├── scripts/               # Handler scripts
├── data/                  # Data storage
└── views/                 # View components (if local)
```

---

## 10. Appendix

### 10.1 Complete Type Definitions

See reference implementation: `@lavs/types`

### 10.2 Migration from Custom APIs

To migrate existing agent APIs to LAVS:

1. Create `lavs.json` manifest
2. Wrap existing API endpoints as handlers
3. Define schemas for validation
4. Update frontend to use LAVS client

### 10.3 Performance Considerations

- **Script handlers**: Have startup overhead, consider long-running processes
- **Caching**: Implement response caching for read-heavy workloads
- **Batching**: Support batch operations to reduce round trips

### 10.4 Future Extensions

Possible future additions:

- **Streaming responses**: For large datasets
- **Transactions**: Multi-operation atomicity
- **Middleware**: Custom validation/transformation hooks
- **Service discovery**: Registry for finding LAVS services

---

## 11. View Dispatch Protocol (v1.1)

This section is normative in v1.1. It specifies how a host renders the right
view bundle for a given piece of structured data inside a single host session
that may span many content-types. v1.0 behavior is the `pinned` host mode
(§11.4) and is unchanged.

> **Note (2026-07-29):** §11 was originally drafted when LAVS targeted
> AgentStudio-style conversational hosts. LAVS has since repositioned to
> CLI-first. The **tool-result dispatch** path (§11.1.1) is the normative
> v1.1 mechanism — it is the only dispatch path the standalone host
> implements. The **artifact dispatch** path (§11.1.2) remains in the spec
> as a future extension for conversational host integration; it is not
> required for v1.1 conformance. Data scoping is per-bundle
> (`<bundleDir>/data/`), not per-conversation; see §11.5.

### 11.1 Dispatch triggers

A host renders a view in two situations. Both resolve to the same view bundle;
they differ in how the content-type is discovered.

1. **Tool-result dispatch (normative in v1.1).** The agent calls a LAVS endpoint
   tool (`lavs_<endpoint>`) — either via CLI (`lavs call --agent-dir <bundle>`)
   or MCP (`lavs_call`). The host knows which bundle the tool belongs to (by the
   tool's owning manifest). It renders that bundle's view with the tool result.
   No envelope is needed — the content-type is implied by the tool. **This is
   the only dispatch path the standalone host implements; CLI-first adoption
   relies on it exclusively.**

2. **Artifact dispatch (future extension).** The agent emits a structured
   artifact in a conversational host (not via a LAVS op). The host reads the
   artifact's `contentType`, looks up the registry, and renders the matching
   view. Requires the envelope (§11.2). **Not required for v1.1 conformance;
   reserved for conversational host integration.**

### 11.2 Artifact envelope (future — §11.1.2 only)

A typed artifact the agent/host exchange. Minimal, JSON-RPC-friendly:

```typescript
interface LAVSArtifact {
  lavs: '1.0';
  contentType: string;        // matches a bundle's contentType (or name)
  title?: string;              // human label for the view tab/panel
  data?: any;                  // initial payload for one-shot rendering
  init?: {                     // optional: endpoint call to bootstrap live data
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
- The envelope carries **no** `instanceId` in v1.1 (see §11.6).

### 11.3 View registry

The host discovers bundles and builds `content-type → bundle`.

**Local registry** (v1.1): a directory of bundle folders, each with a
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
  `lavs.json` directly).
- Dispatch mode: host loads every `lavs.json`, indexes by `contentType ?? name`.
- Duplicate content-types across bundles are a load-time error.
- Remote registry / discovery is out of scope for v1.1 (future extension).

### 11.4 Host modes

- **pinned** — load exactly one bundle; the agent operates within one
  content-type. Equivalent to v1.0. `contentType` is declared but unused for
  dispatch. Data scope = `<agentDir>/data`.
- **dispatch** — load a registry; render the matching view per bundle; many
  views coexist in one host session. Data scope = per-bundle (`<bundleDir>/data`)
  (§11.5).

### 11.5 Dispatch algorithm and data scope

```
on tool result from bundle B:
  ct = B.contentType
  bundle = registry[ct]
  if !bundle:
      render fallback (list|table|json) or skip         // §11.7
      return
  scope = bundleDir/data
  iframe = mount bundle.view.component in sandboxed iframe (pooled)
  bind iframe to (bundle, scope)                         // routes lavs-call
  // SSE agent-action events route into the iframe only when the action's
  // contentType matches the iframe's bound bundle
```

- Pinned mode: `scope = <agentDir>/data` (v1.0 behavior, unchanged).
- Dispatch mode: `scope = <bundleDir>/data/`. Each bundle gets an isolated
  data directory. `permissions.fileAccess` globs resolve against `scope`.
- The host pools one iframe per opened bundle (switching bundles hides, not
  destroys, the frame — view state survives). The host routes every `lavs-call`
  from an iframe to the **bound bundle's** endpoints (resolved from
  `event.source`). `lavs-agent-action` notifications are routed into the iframe
  only when the action's `contentType` matches the iframe's bound bundle.
- The artifact-dispatch variant (`on typed artifact A`) and its
  per-`(conversationId, contentType)` scoping are a future extension (§11.1.2)
  and not part of the standalone host's v1.1 behavior.

### 11.6 Instance scoping (deferred)

v1.1 keys data by content-type (one data store per bundle) — one data store
per content-type per host session. Multiple tool calls against the *same*
bundle in one session share that store. Multiple *instances* of the same
content-type (two independent todo lists) is deferred; the envelope reserves no
`instanceId` field. If needed later it is added as optional and endpoints opt
in to receiving it.

### 11.7 Fallback rendering (normative in v1.1)

`view.fallback` (`list` | `table` | `json`) is declared in the manifest. In
v1.1 it is **load-bearing**: when no bundle matches a content-type, or a
bundle's view component fails to load, the host MUST fall back.

- No bundle for `contentType` → render `json` fallback of the artifact data
  with a "no view installed" affordance.
- Bundle exists but component fails → use the bundle's declared `fallback`
  (default `table`) over the last known data.

### 11.8 Security considerations for dispatch mode

Dispatch multiplies the attack surface: a host loads many bundles and renders
many views in one conversation.

1. **ADVISORY permissions become more dangerous.** With many bundles mounted,
   a single malicious bundle can read across scopes if no sandbox backs the
   permission model. Dispatch mode SHOULD require (or strongly recommend)
   OS-level sandboxing (Docker / nsjail / platform sandbox) before loading
   untrusted bundles. The registry loader SHOULD refuse bundles whose
   `fileAccess` globs escape their own scope.
2. **Per-scope isolation MUST be enforced at the executor.** Script/http
   executors MUST resolve `permissions.fileAccess` against the artifact's scope
   and reject out-of-scope access at dispatch time (not only path-traversal on
   `cwd`/`command` as in v1.0).
3. **SSE fan-out MUST be scoped.** Subscriptions are keyed by scope so that
   views in different conversations do not receive each other's events.

These do not change v1.0 pinned-mode behavior; they are implementation
prerequisites for untrusted-bundle dispatch.

---

## 12. UI Command Protocol (`notify` endpoints)

> Status: **v1.2-draft** — implemented in `@lavs/runtime` (host + CLI + MCP) and
> the official bundles. Additive; fully backward-compatible with v1.0/v1.1.

### 12.1 Motivation

v1.0/v1.1 give the agent one-way control over view **data** (mutations) with
refresh as the only view reaction. Pure view-layer affordances — switch layout,
collapse a panel, change a filter that is not persisted — had no agent-reachable
representation. §12 closes that gap while preserving the one-way control
invariant: **the agent commands the view; the view never commands the agent.**

### 12.2 Endpoint shape

A UI command is a manifest endpoint with `"method": "notify"`:

```json
{
  "id": "setCompact",
  "method": "notify",
  "description": "Toggle compact layout. No data changes.",
  "schema": {
    "input": { "type": "object", "properties": { "on": { "type": "boolean" } } }
  }
}
```

- `handler` is **optional** for `notify` (and required for all other methods).
  A handler-less notify endpoint executes nothing server-side; the broadcast is
  the whole effect. A handler MAY be present when the command also has an
  observable side effect (telemetry, logging, …); its result is carried in the
  broadcast payload.
- Input schemas are validated like any other endpoint.

### 12.3 Agent invocation

The agent uses the same channels as every other endpoint — no new tool surface:

```bash
lavs call setCompact --agent-dir ./bundles/todo-list --input '{"on":true}'
```

Via MCP the endpoint appears as tool `lavs_setCompact`, same as query/mutation.

### 12.4 Broadcast payload

Executing a `notify` endpoint broadcasts an agent-action (same SSE stream and
contentType routing as §5/§11) with `action.type = "ui_command"`:

```json
{
  "type": "lavs-agent-action",
  "action": {
    "type": "ui_command",
    "tool": "lavs_setCompact",
    "command": "setCompact",
    "args": { "on": true },
    "contentType": "lavs/todo-list",
    "timestamp": 1789650543223,
    "result": { "ok": true }
  }
}
```

`tool_executed` payloads (mutations) are unchanged. `command` and `args` are
absent on `tool_executed` payloads.

### 12.5 View-side contract

Views SHOULD keep a command registry; commands registered there are handled
locally (no data round-trip). **Views MUST fall back to a data refresh for
`ui_command` payloads whose command they do not recognize**, so old views
remain correct under new bundles and vice versa.

### 12.6 Security

- Commands are only ever delivered host → iframe, in the one-way direction.
  A view cannot invoke commands or address the agent through this channel.
- Input is schema-validated server-side before broadcast, like mutations.
- `notify` endpoints are exposed as agent tools; bundle authors must assume
  any registered command can be invoked arbitrarily often and with arbitrary
  schema-valid arguments. Views MUST treat command arguments as untrusted
  input (no `innerHTML` from `args`, etc.).

---

## References

- JSON-RPC 2.0: https://www.jsonrpc.org/specification
- JSON Schema: https://json-schema.org/
- Model Context Protocol: https://modelcontextprotocol.io/
- Web Components: https://developer.mozilla.org/en-US/docs/Web/API/Web_components

---

## License

This specification is licensed under Apache License 2.0.

Copyright 2025 AgentStudio Team

---

## Changelog

### v1.2-draft (2026-09-17)
- **UI Command Protocol** (§12): `notify` endpoint method for pure view-layer
  commands. Handler optional for notify; agent-action gains `action.type:
  "ui_command"` with `command`/`args`. Views fall back to refresh on unknown
  commands. Fully backward-compatible.

### v1.1.0-draft (2026-07-16)
- **View Dispatch Protocol** (§11): multiple views per conversation, dispatched
  by content-type. Backward-compatible with v1.0.
- Manifest gains optional `contentType` (defaults to `name`).
- Two first-class host modes: `pinned` (v1.0 behavior) and `dispatch`.
- Artifact envelope (§11.2) for typed artifacts.
- View registry + content-type dispatch (§11.3, §11.5).
- Per-`(conversation, contentType)` data scope in dispatch mode (§11.5).
- `lavs-agent-action` gains `contentType` and recommends `result`.
- Fallback rendering (`list`/`table`/`json`) made normative (§11.7).
- Dispatch-mode security considerations (§11.8).

### v1.0.0-draft (2025-01-15)
- Initial draft specification
