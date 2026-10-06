# lavs-types

## 0.4.1

### Patch Changes

- 9fe8fcd: fix(runtime): cap script handler timeout by `permissions.maxExecutionTime`

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

- dc8157b: Host 信任边界默认收紧（issue #17）：

  1. **CORS 不再无条件发 `Access-Control-Allow-Origin: *`。** 跨源请求访问
     `/api/*`、`/view/*` 一律返回 403，且响应不带 CORS 头；同源与不带 `Origin`
     的客户端（`curl`、`lavs call`、MCP server）行为不变。需要跨源的嵌入方必须
     显式开启：SDK `createHostServer` / `createHostHandler` 传
     `allowOrigins: ['http://host:port']`（或 `['*']`），CLI 传
     `--allow-origin <origin>`（可重复，daemon 安装时同样透传）。同源判定由请求的
     `Host` 头推导并要求 loopback 主机名，因此伪造 `Host` + `Origin` 的
     DNS rebinding 不视为同源。

  2. **绝对路径 `view.staticRoots` 默认不挂载。** 之前 `{ mount, path: '<绝对路径>' }`
     会直接暴露 bundle 目录之外的任意文件；现在该 mount 默认被跳过并打日志
     （不报错，避免整个 bundle 静默消失）。需显式开启：SDK
     `allowAbsoluteStaticRoots: true`，CLI `--allow-absolute-static-roots`。
     bundle 相对路径的 root 不受影响。

  3. **`/api/discover` 不再回传绝对路径（破坏性变更）。** 对读该响应的外部嵌入方：
     `dir` 变为相对 registry 目录的路径（单 bundle 模式为 `'.'`）、`registryDir`
     变为 registry 目录名（仅作分组标签）、`staticRoots[].base` 变为相对 bundle
     目录的路径。进程内的 `BundleInfo`（`lavs discover` 输出、文件服务）仍是绝对
     路径，未变。

  遗留面：

  - `GET /api/manifest/:bundle` 仍回传 loader 归一化后的 manifest（含绝对化路径）。
    跨源收紧后该端点已不可被跨源页面读取，但响应体本身尚未去绝对化。
  - `GET /api/registries`（含 POST/DELETE）仍回传绝对目录，host UI 的工作区列表
    依赖它；跨源收紧后仅同源可读。

  Python host 对齐（issue #28，Python SDK 不走 Changesets，仅在此记录）：
  `lavs_runtime.host` 现在与 TS 同一边界——跨源请求访问 `/api/*`、`/view/*` 默认
  403 且不带 CORS 头（`LavsHost(allow_origins=[...])` 可显式放行），绝对路径
  `view.staticRoots` 默认跳过并打日志（`allow_absolute_static_roots=True` 开启），
  `/api/discover` 的 `dir` / `registryDir` / `staticRoots[].base` 同样相对化。
  上述两处遗留面在 Python host 同样存在。

## 0.4.0

### Minor Changes

- 916a07f: New `view.staticRoots` (issue #12): manifests can declare `[{ mount, path }]` under `view` to serve files OUTSIDE the bundle dir at `/view/:bundle/<mount>/<rel>` (bundle-relative or absolute paths). Each root is lexically bounded by its own resolved base — `..` cannot escape it, roots cannot reach each other, undeclared paths stay bounded by the bundle dir. Same media semantics as #4 (MIME map, Content-Length, Accept-Ranges, single-part Range → 206/416, HEAD). Invalid mount names are rejected at discovery time.

## 0.3.0

### Minor Changes

- 8d41a94: First public release track: UI Command Protocol (SPEC §12) + view-side SDK.

  - **lavs-types / runtime / client**: new `notify` endpoint method (pure UI commands, handler optional); agent-action gains `action.type: "ui_command"` with `command`/`args`; host-server broadcasts ui_command on `/api/call` and `/api/notify`; tool-generator exposes notify endpoints as agent tools (CLI + MCP).
  - **lavs-view**: new package — postMessage bridge (`view.call`), UI command registry with unknown-command refresh fallback; prebuilt IIFE for no-build bundle views.

## 0.2.0

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

## 0.1.1

### Patch Changes

- 9168541: chore: test automated release flow with changesets
