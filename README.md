# LAVS — Local Agent View Service

**Protocol Version**: 1.0  
**Status**: Active Development (pre-release)

LAVS is a protocol that bridges **AI Agents** and **Visual UIs**. It enables local AI agents to expose structured data interfaces that can be rendered as interactive visual components alongside conversational chat.

## What Problem Does LAVS Solve?

Current AI agent protocols handle:
- **MCP** (Model Context Protocol): Agent ↔ External Tools
- **A2A** (Agent-to-Agent): Agent ↔ Agent communication
- **MCP Resources**: Read-only data context for LLMs

**Gap**: No standard way for agents to expose internal data to visual frontends with bidirectional sync.

LAVS fills this gap:

```
┌────────────────────────────────────────────────────┐
│     Visual Layer (LAVS)     ← Agent's "face"       │
│  View + Query + Mutation + Subscription + AI Sync   │
├────────────────────────────────────────────────────┤
│     Context Layer (MCP Resources)                   │
├────────────────────────────────────────────────────┤
│     Tool Layer (MCP Tools)                          │
├────────────────────────────────────────────────────┤
│     Comm Layer (A2A)                                │
└────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Define Your Agent's Interface

Create a `lavs.json` manifest:

```json
{
  "lavs": "1.0",
  "name": "todo-service",
  "version": "1.0.0",
  "description": "A todo management service",
  "endpoints": [
    {
      "id": "listTodos",
      "method": "query",
      "description": "List all todos",
      "handler": {
        "type": "script",
        "command": "node",
        "args": ["scripts/list-todos.js"]
      },
      "schema": {
        "output": { "$ref": "#/types/TodoList" }
      }
    },
    {
      "id": "addTodo",
      "method": "mutation",
      "description": "Add a new todo",
      "handler": {
        "type": "script",
        "command": "node",
        "args": ["scripts/add-todo.js"],
        "input": "args"
      },
      "schema": {
        "input": {
          "type": "object",
          "required": ["text"],
          "properties": {
            "text": { "type": "string" },
            "priority": { "type": "integer", "minimum": 1, "maximum": 5 }
          }
        },
        "output": { "$ref": "#/types/Todo" }
      }
    }
  ],
  "view": {
    "component": {
      "type": "local",
      "path": "./view/index.html"
    }
  },
  "types": {
    "Todo": {
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "text": { "type": "string" },
        "done": { "type": "boolean" },
        "priority": { "type": "integer" }
      }
    },
    "TodoList": {
      "type": "array",
      "items": { "$ref": "#/types/Todo" }
    }
  },
  "permissions": {
    "fileAccess": ["./data/**/*.json"],
    "maxExecutionTime": 5000
  }
}
```

### 2. Implement Handlers

Each endpoint has a handler that defines how to execute it:

```javascript
// scripts/list-todos.js
const fs = require('fs');
const path = require('path');

const projectPath = process.env.LAVS_PROJECT_PATH || '.';
const dataFile = path.join(projectPath, 'data', 'todos.json');

try {
  const todos = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  console.log(JSON.stringify(todos));
} catch {
  console.log(JSON.stringify([]));
}
```

### 3. Create a View Component

View components run in an iframe and communicate via `postMessage`:

```html
<!-- view/index.html -->
<!DOCTYPE html>
<html>
<head><title>Todo View</title></head>
<body>
  <div id="todos"></div>
  <script>
    // LAVS provides these globals:
    // window.LAVS_AGENT_ID, window.LAVS_PROJECT_PATH

    // Call LAVS endpoint via postMessage
    function callEndpoint(endpoint, input) {
      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).slice(2);
        const handler = (event) => {
          if (event.data.id !== id) return;
          window.removeEventListener('message', handler);
          if (event.data.type === 'lavs-result') resolve(event.data.result);
          else reject(new Error(event.data.error));
        };
        window.addEventListener('message', handler);
        window.parent.postMessage({ type: 'lavs-call', id, endpoint, input }, '*');
      });
    }

    // Listen for AI agent actions
    window.addEventListener('message', (event) => {
      if (event.data.type === 'lavs-agent-action') {
        console.log('Agent did:', event.data.action);
        loadTodos(); // Refresh on any agent action
      }
    });

    async function loadTodos() {
      const todos = await callEndpoint('listTodos');
      document.getElementById('todos').innerHTML = todos
        .map(t => `<div>${t.done ? '✅' : '⬜'} ${t.text}</div>`)
        .join('');
    }

    loadTodos();
  </script>
</body>
</html>
```

## Architecture

```
┌──────────────┐        ┌──────────────┐
│  Chat Panel  │        │  LAVS View   │
│  (AI对话面板)  │        │  (可视化面板)  │
└──────┬───────┘        └──────┬───────┘
       │                       │
       │   AI calls tool       │  View calls endpoint
       │   lavs_addTodo()      │  postMessage('lavs-call')
       │                       │
       ▼                       ▼
┌──────────────────────────────────────┐
│           LAVS Runtime               │
│  ┌─────────┐  ┌─────────────────┐   │
│  │ Manifest │  │ Script Executor │   │
│  │ Loader   │→ │ (node/python)   │   │
│  └─────────┘  └─────────────────┘   │
│  ┌─────────┐  ┌─────────────────┐   │
│  │Validator │  │  Permission     │   │
│  │ (Schema) │  │  Checker        │   │
│  └─────────┘  └─────────────────┘   │
└──────────────────────────────────────┘
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Manifest** | `lavs.json` declares endpoints, view, permissions |
| **Endpoint** | `query` (read), `mutation` (write), `subscription` (real-time) |
| **Handler** | `script`, `function`, `http`, `mcp` — how to execute |
| **View** | iframe-based UI component with postMessage bridge |
| **AI ↔ UI Sync** | AI tool executions notify the view via store → postMessage |

## Handler Types

| Type | Description | Status |
|------|-------------|--------|
| `script` | Execute CLI command (node, python, etc.) | ✅ |
| `function` | Call JS/TS function directly | ✅ |
| `http` | Proxy to HTTP endpoint | Planned |
| `mcp` | Bridge to MCP server tool | Planned |

## Security Model

| Permission | Enforcement | Notes |
|-----------|-------------|-------|
| Path traversal | **ENFORCED** | Handler paths validated |
| Input validation | **ENFORCED** | JSON Schema on all inputs |
| maxExecutionTime | **ENFORCED** | Script killed on timeout |
| fileAccess | ADVISORY | Glob patterns for auditing |
| networkAccess | ADVISORY | Declared, not enforced |
| CSP | **ENFORCED** | Nonce-based script policy |

## Project Structure

```
platform/lavs/
├── docs/
│   ├── SPEC.md                    # Full protocol specification
│   └── PROTOCOL-ANALYSIS.md       # Gap analysis & improvement plan
├── sdk/
│   ├── typescript/                # TypeScript/Node.js SDK
│   │   ├── types/src/index.ts     # Core type definitions
│   │   ├── runtime/src/           # Reference runtime (to be extracted)
│   │   └── client/src/            # Client SDK (to be extracted)
│   └── python/                    # Python SDK (planned)
│       ├── lavs_types/            # Type definitions (Pydantic models)
│       ├── lavs_runtime/          # Reference runtime
│       └── lavs_client/           # Client SDK
├── schema/
│   └── lavs-manifest.schema.json  # JSON Schema for IDE autocomplete
├── examples/
│   └── jarvis-agent/              # Example agent (planned)
└── README.md
```

The `sdk/` directory is organized by language. Each language provides three packages:
- **types**: Core protocol type definitions (generated from JSON Schema)
- **runtime**: Server-side runtime (manifest loading, handler execution, validation)
- **client**: Client SDK for calling LAVS endpoints from UIs

## LAVS vs MCP Resources

LAVS and MCP Resources are **complementary**, not competing:

| | LAVS | MCP Resources |
|-|------|---------------|
| Direction | Bidirectional (AI ↔ UI) | One-way (Server → LLM) |
| Operations | Query + Mutation + Subscription | Read-only |
| UI binding | View Components | None |
| Purpose | Agent's visual interface | Agent's data context |

Best combination: LAVS `type: 'mcp'` handler uses MCP Resources as data source, rendered through LAVS View Components.

## Current Integration

LAVS is currently integrated into [AgentStudio](../agentstudio/) via the `feature/lavs-poc` branch.

**Reference implementation**:
- Backend: `agentstudio/.worktrees/lavs/backend/src/lavs/` (runtime modules)
- Frontend: `agentstudio/.worktrees/lavs/frontend/src/lavs/` (client SDK)
- Routes: `agentstudio/.worktrees/lavs/backend/src/routes/lavs.ts` (HTTP API)

## Roadmap

- [x] Protocol spec v1.0
- [x] Security hardening (CSP nonce, postMessage origin, publish auth)
- [x] Spec alignment (SSE subscriptions, unified error format)
- [x] JSON Schema for manifest validation
- [x] postMessage protocol documentation
- [x] File watcher for cache invalidation
- [x] Unit tests + integration tests
- [ ] Extract runtime as `@lavs/runtime` npm package
- [ ] Extract client as `@lavs/client` npm package
- [ ] Implement `http` and `mcp` handler types
- [ ] CLI tooling (`lavs init`, `lavs validate`)
- [ ] Independent repository and npm publishing

## License

TBD
