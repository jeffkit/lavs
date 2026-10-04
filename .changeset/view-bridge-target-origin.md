---
"lavs-view": patch
"lavs-runtime": patch
---

Security fix (issue #18): the view bridge no longer posts with a wildcard target origin (`postMessage(..., '*')`), and the view listener validates `event.origin` / `event.source` before acting — a same-origin sibling bundle view can no longer forge `lavs-result` / `lavs-agent-action` messages. `lavs-call` ids become unguessable random tokens instead of a predictable counter. SPEC §7.4 updated accordingly.
