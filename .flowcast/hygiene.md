# lavs 卫生铁律

> 本文件被 pge flow 的 Generator/repair prompt 自动读取并注入（见 pge.flow.js 的 `loadHygiene`）。
> lavs 是 TS + Python 双端 SDK 协议仓，铁律核心是「协议权威 + 双端一致」。

## 协议权威（最高优先级）

- **协议权威文档是 `docs/SPEC.md`**，实现以 `sdk/` 为准。改协议行为**必须同步**
  `docs/SPEC.md` 与 `schema/`——不同步就是 bug。
- **禁止只改 TS 或 Python 一侧**：协议层的变更（类型、消息、View 协议）必须双端同步，
  否则 TS/Python SDK 语义漂移。改完一侧后，检查另一侧是否需要对应改动。
- **禁止在 SDK 中硬编码业务 Agent 清单**：SDK 只定义协议与类型，业务 Agent 清单
  用 examples 或业务仓维护。

## TS 端工程规范

- **构建顺序**：types → runtime → client（runtime 依赖 types，client 依赖 runtime）。
  `pnpm build` 已按序串好，不要单独跑后端包的 build 而跳过依赖。
- **tsc 即类型检查**：没有独立 typecheck script，`pnpm build` 里的 `tsc` 同时做编译+类型检查。
  类型错误会在 build 门暴露。
- **测试用 vitest**：`sdk/typescript/runtime` 下的 `.test.ts`。新功能/修复都要加测试。
- **版本用 Changesets**：改了包要 `pnpm changeset` 生成变更记录，不要手改 package.json version。

## Python 端工程规范

- **用 uv 管理依赖**：`cd sdk/python && uv sync` 安装，`uv run pytest` 跑测试。
- **ruff 配置在 `sdk/python/pyproject.toml`**：line-length 100，rules E/F/I/N/W/UP。
  不许引入 ruff 未启用的规则风格。
- **asyncio_mode = auto**：异步测试函数自动被 pytest-asyncio 捕获，不用手写 `@pytest.mark.asyncio`。

## 模块导出

- **TS 包入口**：每个子包（types/runtime/client）的 package.json `main`/`types`/`exports`
  要正确声明。新增导出要在 package.json 的 exports map 里登记。
- **Python 包**：`lavs_types`/`lavs_runtime`/`lavs_client` 三个顶层包，新增模块
  要在对应包的 `__init__.py` 导出公开 API。
