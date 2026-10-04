---
"lavs-runtime": minor
"lavs-types": patch
---

Host 信任边界默认收紧（issue #17）：

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
- Python `lavs_runtime.host`（`_bundle_info` 回传绝对 `dir`、绝对 staticRoots 默认
  生效、无 Origin 校验）存在同等缺口，需另行对齐，本变更仅覆盖 TypeScript。
