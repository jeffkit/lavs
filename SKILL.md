---
name: lavs
description: >
  Use the LAVS CLI to open interactive views alongside your conversation.
  When the user wants to see structured data visually (todos, notes, tables,
  dashboards) or asks to "show", "display", "open", or "visualize" something,
  use lavs commands to render a live view in the browser beside the chat.
---

# LAVS — Local Agent View Service

LAVS lets you open a live browser-based view alongside any conversation.
The view stays in sync with data you manipulate via `lavs call`.

## When to use

- User says "show me the todos", "open the dashboard", "visualize X"
- You produced structured data that the user would benefit from seeing as a UI
- You need to let the user interact with data (add, edit, delete) through a view
- User asks to "open the view" or "start lavs"

## Core commands

### Open the view host

```bash
# Open all bundles in current directory
npx lavs-runtime view --registry-dir .

# Open a specific bundle by name or content-type
npx lavs-runtime view todo-list --registry-dir .

# Custom port
npx lavs-runtime view --port 8080 --registry-dir .
```

This starts a local server and opens a browser tab with the LAVS host.
The view auto-refreshes whenever you call `lavs call` on an endpoint.

### Discover available bundles

```bash
npx lavs-runtime discover --registry-dir .
```

Lists all LAVS bundles found in the directory. Run this first to see what's available.

### Call an endpoint directly

```bash
# Query (read data)
npx lavs-runtime call listTodos --agent-dir ./agents/todos

# Mutation (write data) — view auto-refreshes
npx lavs-runtime call addTodo --agent-dir ./agents/todos --input '{"text":"Buy milk","priority":2}'

# Pipe output
npx lavs-runtime call listTodos --agent-dir ./agents/todos | jq '.[] | select(.done == false)'
```

If the LAVS host is running, the connected view refreshes automatically after any mutation call.

### Scaffold a new bundle

```bash
npx lavs-runtime init --agent-dir ./agents/my-bundle
npx lavs-runtime validate --agent-dir ./agents/my-bundle
```

## Workflow

1. **Discover**: `lavs-runtime discover` — find out what bundles exist
2. **Open host**: `lavs-runtime view` — browser tab opens with the host UI
3. **Manipulate data**: `lavs-runtime call <endpoint> --input '...'` — view updates live
4. **No host needed for data ops**: `lavs call` works standalone; just stdout JSON

## Tips for agents

- After calling a mutation endpoint, you don't need to explicitly refresh the view —
  the `lavs call` CLI automatically notifies the running host server.
- If no view exists for a bundle, the host shows a fallback with endpoint info.
- Keep the host running in the background; the user can switch between bundles in the sidebar.
- The default host port is **7842**. Use `--port` to change it if needed.
- `lavs call` result goes to stdout — you can parse it and continue your reasoning.

## Example session

```
User: "Show me my todos"

Agent:
1. Run: npx lavs-runtime discover --registry-dir .
   → Finds bundle "todo-list" at ./agents/todos

2. Run: npx lavs-runtime view todo-list --registry-dir .
   → Opens http://localhost:7842/#todo-list in browser

3. Say: "I've opened the todo view in your browser. You can see your todos there.
         Would you like me to add anything?"

User: "Add 'Buy milk' with high priority"

Agent:
4. Run: npx lavs-runtime call addTodo --agent-dir ./agents/todos \
        --input '{"text":"Buy milk","priority":1}'
   → View refreshes automatically
   → Output: {"id":1753,"text":"Buy milk","priority":1,"done":false}

5. Say: "Done! 'Buy milk' has been added. The view updated automatically."
```
