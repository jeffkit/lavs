---
"lavs-runtime": minor
---

New `lavs-runtime view --bare [bundle]`: host runs full capability (postMessage bridge, /api/call, SSE, /view/*) but header, sidebar and view toolbar are hidden so a bundle view with its own chrome owns the whole page. Auto-opens the named bundle (name or contentType).
