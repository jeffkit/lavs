# lavs-view

## 0.2.1

### Patch Changes

- ec28497: Security fix (issue #18): the view bridge no longer posts with a wildcard target origin (`postMessage(..., '*')`), and the view listener validates `event.origin` / `event.source` before acting — a same-origin sibling bundle view can no longer forge `lavs-result` / `lavs-agent-action` messages. `lavs-call` ids become unguessable random tokens instead of a predictable counter. SPEC §7.4 updated accordingly.

## 0.2.0

### Minor Changes

- 8d41a94: First public release track: UI Command Protocol (SPEC §12) + view-side SDK.

  - **lavs-types / runtime / client**: new `notify` endpoint method (pure UI commands, handler optional); agent-action gains `action.type: "ui_command"` with `command`/`args`; host-server broadcasts ui_command on `/api/call` and `/api/notify`; tool-generator exposes notify endpoints as agent tools (CLI + MCP).
  - **lavs-view**: new package — postMessage bridge (`view.call`), UI command registry with unknown-command refresh fallback; prebuilt IIFE for no-build bundle views.
