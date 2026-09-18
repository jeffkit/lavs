# lavs-runtime

## 0.7.0

### Minor Changes

- 916a07f: New `view.staticRoots` (issue #12): manifests can declare `[{ mount, path }]` under `view` to serve files OUTSIDE the bundle dir at `/view/:bundle/<mount>/<rel>` (bundle-relative or absolute paths). Each root is lexically bounded by its own resolved base — `..` cannot escape it, roots cannot reach each other, undeclared paths stay bounded by the bundle dir. Same media semantics as #4 (MIME map, Content-Length, Accept-Ranges, single-part Range → 206/416, HEAD). Invalid mount names are rejected at discovery time.

## 0.6.1

### Patch Changes

- 91e9d12: Fix: `lavs-runtime serve` / `serve-registry` crashed on any endpoint declaring `schema.input` ("inputSchema must be a Zod schema or raw shape"). Endpoints now convert JSON Schema to Zod properly (string/number/integer/boolean/null/array/object, enum, anyOf/oneOf; unknown → `z.any()`), honouring `required` and keeping descriptions.

## 0.6.0

### Minor Changes

- aed9dbe: New `lavs-runtime view --bare [bundle]`: host runs full capability (postMessage bridge, /api/call, SSE, /view/\*) but header, sidebar and view toolbar are hidden so a bundle view with its own chrome owns the whole page. Auto-opens the named bundle (name or contentType).

## 0.5.1

### Patch Changes

- db90b0c: Fix: first `lavs-call` from a view was silently dropped. The host UI registered the iframe's contentWindow only on the `load` event, but view scripts run (and call endpoints) during parse — before load. Now: register immediately after `appendChild` (load kept as backstop), fall back to scanning pooled frames, and reply `lavs-error: "view not registered yet"` instead of dropping unmatched calls so view promises always settle.

## 0.5.0

### Minor Changes

- d6b6a0c: Host media support in `/view/:bundle/*`: `Range` requests (RFC 7233 single-part → 206/416), `Content-Length`, `Accept-Ranges: bytes`, `HEAD`, and extended MIME map (mp4/mov/webm/mp3/m4a/wav/jpg/jpeg/webp/gif). Enables `<video>` seek/duration for local media in bundle views. Lexical path containment kept intentionally — symlinks to media outside the bundle dir still work.

## 0.4.0

### Minor Changes

- 8d41a94: First public release track: UI Command Protocol (SPEC §12) + view-side SDK.

  - **lavs-types / runtime / client**: new `notify` endpoint method (pure UI commands, handler optional); agent-action gains `action.type: "ui_command"` with `command`/`args`; host-server broadcasts ui_command on `/api/call` and `/api/notify`; tool-generator exposes notify endpoints as agent tools (CLI + MCP).
  - **lavs-view**: new package — postMessage bridge (`view.call`), UI command registry with unknown-command refresh fallback; prebuilt IIFE for no-build bundle views.

## 0.3.0

### Minor Changes

- ## v1.1 View Dispatch Protocol + CLI-first standalone host

  ### lavs-runtime (0.2.0 → 0.3.0)

  **Standalone Host & CLI**

  - `lavs view [contentType]` — 启动本地 HTTP host，自动打开浏览器 tab
  - `lavs discover [--registry-dir]` — 扫描目录的 lavs.json bundle 列表
  - `lavs call <endpoint>` — 直接 CLI 调用，stdout 输出干净 JSON 可管道
  - Daemon 支持：后台保持 host 运行，`lavs host` 系列命令管理
  - `LAVS_HOST_PORT` 环境变量解耦端口；`--quiet` 抑制诊断日志

  **Dispatch Mode (v1.1)**

  - iframe 池多 view 并存：每种 contentType 拥有独立 iframe
  - SSE 按 contentType 路由：agent-action 事件精准推送到对应 view
  - `broadcastAgentAction` 携带真实 contentType（修复 bundleName 混用 bug）

  **Bug fixes & quality**

  - CLI mutation 双重通知修复
  - `/api/discover` 绝对路径泄露修复
  - zod 依赖补充 + TS2589 类型爆炸修复
  - logger 模块抽离（统一诊断输出格式）
  - host-server 单元测试覆盖（258 行）

  ### lavs-types (0.1.1 → 0.2.0)

  - `contentType` 字段加入 `LAVSManifest`（可选，格式 `vendor/name`）
  - `McpServerConfig` / `McpConfigFile` 类型新增

  ### lavs-client (0.1.1 → 0.2.0)

  - 同步 `contentType` + `McpServerConfig` / `McpConfigFile` 类型

## 0.2.0

### Minor Changes

- 8880ded: feat: 新增标准 MCP Server 支持，LAVS 可作为 agent 无关的 MCP 工具服务

  - 新增 `createLAVSMcpServer()` API，基于 @modelcontextprotocol/sdk 创建标准 MCP Server
  - 新增 `connectStdio()` 便捷函数，支持 stdio 传输
  - 新增 `lavs-runtime serve` CLI 命令，支持 `npx lavs-runtime serve --agent-dir ./agents/xxx`
  - 新增 `getLAVSToolNames()` 工具命名约定函数
  - 任何支持 MCP 的 Agent（Claude Code、Cursor、自研框架等）均可通过配置 mcp.json 直接接入

## 0.1.1

### Patch Changes

- b51ae88: fix(tool-generator): pass manifest types to validator for $ref resolution, make output validation non-blocking

  - Pass `manifest.types` to `assertValidInput` and `assertValidOutput` so that `$ref: "#/types/Todo"` style references can be resolved by ajv
  - Wrap output validation in try-catch: log warnings on schema mismatch instead of throwing, ensuring tools still return data even if output has minor schema deviations (e.g. missing timezone designator in date-time fields)

- 9168541: chore: test automated release flow with changesets
