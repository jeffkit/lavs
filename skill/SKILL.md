---
name: lavs-agent-dev
description: Create LAVS-compatible agents for AgentStudio from natural language descriptions. Generates agent config, lavs.json manifest, handler scripts, and optional visual UI (view component). Use when the user wants to create a new agent with data visualization, build a LAVS agent, or asks for an agent that has both chat and visual interfaces.
---

# LAVS Agent Development Guide

Create AgentStudio agents with LAVS (Local Agent View Service) capabilities — enabling both conversational chat and visual data interfaces.

## When to Use

- User says "create an agent that manages X" or "build an agent for Y"
- User wants an agent with a visual interface / dashboard / panel
- User mentions LAVS, lavs.json, or visual agent
- User describes data that needs both AI manipulation and visual display

## Workflow

### Step 1: Understand Requirements

Ask the user (conversationally or via AskQuestion):
1. **What data** does the agent manage? (todos, notes, inventory, metrics, etc.)
2. **What operations** are needed? (list, add, update, delete, search, etc.)
3. **Does the user want a visual UI?** (most should say yes)
4. **What's the project path?** Where will the agent live in AgentStudio?

### Step 2: Generate Agent Structure

Create the following directory structure:

```
agents/<agent-name>/
├── agent.json          # AgentStudio agent configuration
├── lavs.json           # LAVS manifest (endpoints, view, permissions)
├── scripts/            # Handler scripts for each endpoint
│   ├── list.js
│   ├── add.js
│   ├── update.js
│   └── delete.js
├── view/
│   └── index.html      # Visual UI component
└── data/               # Data storage directory
    └── .gitkeep
```

### Step 3: Create agent.json

```json
{
  "id": "<agent-name>",
  "name": "<Display Name>",
  "description": "<description>",
  "systemPrompt": "You are <agent-name>, a helpful assistant that manages <domain>. You have access to LAVS tools to manipulate data. Always use the lavs_ prefixed tools to perform operations.",
  "model": "claude-sonnet-4-20250514",
  "tools": ["lavs"]
}
```

### Step 4: Create lavs.json

Follow the JSON Schema at `platform/lavs/schema/lavs-manifest.schema.json`.

Template:

```json
{
  "lavs": "1.0",
  "name": "<service-name>",
  "version": "1.0.0",
  "description": "<description>",
  "endpoints": [
    {
      "id": "list<Items>",
      "method": "query",
      "description": "List all <items>",
      "handler": {
        "type": "script",
        "command": "node",
        "args": ["scripts/list.js"],
        "input": "args"
      },
      "schema": {
        "output": { "type": "array", "items": { "$ref": "#/types/<Item>" } }
      }
    },
    {
      "id": "add<Item>",
      "method": "mutation",
      "description": "Add a new <item>",
      "handler": {
        "type": "script",
        "command": "node",
        "args": ["scripts/add.js"],
        "input": "args"
      },
      "schema": {
        "input": {
          "type": "object",
          "required": ["<required-fields>"],
          "properties": {}
        },
        "output": { "$ref": "#/types/<Item>" }
      }
    }
  ],
  "view": {
    "component": {
      "type": "local",
      "path": "./view/index.html"
    }
  },
  "types": {},
  "permissions": {
    "fileAccess": ["./data/**/*.json"],
    "maxExecutionTime": 5000
  }
}
```

### Step 5: Create Handler Scripts

Each handler script follows this pattern:

```javascript
// scripts/list.js
const fs = require('fs');
const path = require('path');

// LAVS provides project path for data isolation
const projectPath = process.env.LAVS_PROJECT_PATH || '.';
const dataFile = path.join(projectPath, 'data', '<items>.json');

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch {
    return [];
  }
}

function saveData(data) {
  const dir = path.dirname(dataFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

// Main
const items = loadData();
console.log(JSON.stringify(items));
```

For mutation handlers, read input from args:

```javascript
// scripts/add.js
const fs = require('fs');
const path = require('path');

const projectPath = process.env.LAVS_PROJECT_PATH || '.';
const dataFile = path.join(projectPath, 'data', '<items>.json');

// Parse input from command line args
const input = JSON.parse(process.argv[2] || '{}');

function loadData() { /* same as above */ }
function saveData(data) { /* same as above */ }

const items = loadData();
const newItem = {
  id: Date.now(),
  ...input,
  createdAt: new Date().toISOString()
};
items.push(newItem);
saveData(items);

console.log(JSON.stringify(newItem));
```

### Step 6: Create View Component (if requested)

Template for `view/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AGENT_NAME View</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8fafc;
      color: #1e293b;
      padding: 16px;
    }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .header h1 { font-size: 18px; font-weight: 600; }
    .list { display: flex; flex-direction: column; gap: 8px; }
    .item {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: box-shadow 0.15s;
    }
    .item:hover { box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .empty { text-align: center; color: #94a3b8; padding: 40px; }
    .loading { text-align: center; color: #64748b; padding: 40px; }
    @media (prefers-color-scheme: dark) {
      body { background: #0f172a; color: #e2e8f0; }
      .item { background: #1e293b; border-color: #334155; }
      .empty, .loading { color: #64748b; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>DISPLAY_NAME</h1>
    <span id="count"></span>
  </div>
  <div id="content" class="loading">Loading...</div>

  <script>
    // LAVS context (injected by runtime)
    const agentId = window.LAVS_AGENT_ID;
    const projectPath = window.LAVS_PROJECT_PATH;

    // Call LAVS endpoint via postMessage
    let callId = 0;
    const pending = new Map();

    function callEndpoint(endpoint, input) {
      return new Promise((resolve, reject) => {
        const id = String(++callId);
        pending.set(id, { resolve, reject });
        window.parent.postMessage({ type: 'lavs-call', id, endpoint, input }, '*');
      });
    }

    window.addEventListener('message', (event) => {
      const { data } = event;
      if (data.type === 'lavs-result' && pending.has(data.id)) {
        pending.get(data.id).resolve(data.result);
        pending.delete(data.id);
      } else if (data.type === 'lavs-error' && pending.has(data.id)) {
        pending.get(data.id).reject(new Error(data.error));
        pending.delete(data.id);
      } else if (data.type === 'lavs-agent-action') {
        // AI executed a tool - refresh data
        loadData();
      }
    });

    // Render items
    function render(items) {
      const content = document.getElementById('content');
      const count = document.getElementById('count');
      count.textContent = `${items.length} items`;

      if (items.length === 0) {
        content.innerHTML = '<div class="empty">No items yet. Ask the AI to add some!</div>';
        content.className = 'empty';
        return;
      }

      content.className = 'list';
      content.innerHTML = items.map(item =>
        `<div class="item">${renderItem(item)}</div>`
      ).join('');
    }

    // Customize this for your data type
    function renderItem(item) {
      return `<span>${JSON.stringify(item)}</span>`;
    }

    // Load and display data
    async function loadData() {
      try {
        const items = await callEndpoint('LIST_ENDPOINT');
        render(items);
      } catch (err) {
        document.getElementById('content').innerHTML =
          `<div class="empty">Error: ${err.message}</div>`;
      }
    }

    loadData();
  </script>
</body>
</html>
```

Replace `AGENT_NAME`, `DISPLAY_NAME`, `LIST_ENDPOINT`, and customize `renderItem()`.

## Key Rules

1. **Always use script handlers** (type: 'script') — they're the most reliable
2. **Always use `process.env.LAVS_PROJECT_PATH`** for data isolation
3. **Output JSON to stdout** — this is how handlers return results
4. **Use `input: "args"`** for mutations — input is passed as first CLI argument
5. **Define types in lavs.json** — enables schema validation
6. **Set fileAccess permissions** — even though advisory, it documents intent
7. **Keep view components simple** — vanilla HTML/CSS/JS, no build step
8. **Use `postMessage` for view communication** — not direct API calls

## Security Checklist

- [ ] Handler scripts only access `./data/` directory
- [ ] Input validation via JSON Schema in manifest
- [ ] `maxExecutionTime` set (recommend 5000ms)
- [ ] View uses postMessage (not direct fetch)
- [ ] No secrets in handler scripts

## Examples

See `platform/lavs/docs/SPEC.md` for the full protocol specification.
See `platform/lavs/schema/lavs-manifest.schema.json` for manifest validation.

For a working example, see the Jarvis agent in `agentstudio/.worktrees/lavs/agents/jarvis/`.
