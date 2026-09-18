---
"lavs-types": minor
"lavs-runtime": minor
"lavs-client": minor
"lavs-view": minor
---

First public release track: UI Command Protocol (SPEC §12) + view-side SDK.

- **lavs-types / runtime / client**: new `notify` endpoint method (pure UI commands, handler optional); agent-action gains `action.type: "ui_command"` with `command`/`args`; host-server broadcasts ui_command on `/api/call` and `/api/notify`; tool-generator exposes notify endpoints as agent tools (CLI + MCP).
- **lavs-view**: new package — postMessage bridge (`view.call`), UI command registry with unknown-command refresh fallback; prebuilt IIFE for no-build bundle views.
