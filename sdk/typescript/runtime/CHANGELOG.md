# lavs-runtime

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
