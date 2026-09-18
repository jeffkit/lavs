# lavs-client

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
