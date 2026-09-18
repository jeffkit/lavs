---
"lavs-runtime": minor
---

Embeddable host (issue #14): `lavs-runtime` now exports `createHostHandler` — a mountable handler with NO port binding, so apps can serve LAVS routes (/, /api/*, /api/events SSE, /view/* incl. Range media and staticRoots) from their own http.Server under a `prefix` (one process, one port), plus `notifyAgentAction` / `addRegistryDir` / `removeRegistryDir` / `getRegistryDirs` controls. Also re-exports `createHostServer`, `discoverBundles(FromDirs)` and `buildHostUI` from the package entry. CLI behavior unchanged.
