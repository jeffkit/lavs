---
"lavs-runtime": patch
---

Fix: first `lavs-call` from a view was silently dropped. The host UI registered the iframe's contentWindow only on the `load` event, but view scripts run (and call endpoints) during parse — before load. Now: register immediately after `appendChild` (load kept as backstop), fall back to scanning pooled frames, and reply `lavs-error: "view not registered yet"` instead of dropping unmatched calls so view promises always settle.
