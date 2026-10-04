---
"lavs-runtime": patch
"lavs-types": patch
---

fix(runtime): cap script handler timeout by `permissions.maxExecutionTime`

`ScriptExecutor` resolved its timeout with `handler.timeout || context.timeout || 30000`,
so `permissions.maxExecutionTime` (documented ENFORCED) never constrained script handlers.
The timeout now goes through `PermissionChecker.getEffectiveTimeout`, i.e.
`min(handler.timeout, permissions.maxExecutionTime)`, with `context.timeout ?? 30000` as
the default; the Python runtime applies the same min semantics.

Behavior change: manifests that declare `maxExecutionTime` without `handler.timeout` now
get a shorter effective script timeout (the four in-repo bundles declare `5000`, so they go
from 30s to 5s).

Also documents output schema validation as ADVISORY (warn-and-return) in SPEC §6.2/§6.3 and
the `Permissions` type tables, matching both runtimes' existing behavior.
