# Manifest 字段参考

`lavs.json` 是 LAVS bundle 的清单文件。本文档列出所有字段。

## 完整示例

```json
{
  "lavs": "1.0",
  "name": "todo-service",
  "contentType": "lavs/todo-list",
  "version": "1.0.0",
  "description": "A todo management service",
  "endpoints": [
    {
      "id": "listTodos",
      "method": "query",
      "description": "List all todos",
      "handler": {
        "type": "script",
        "command": "node",
        "args": ["scripts/list.js"],
        "input": "args"
      },
      "schema": {
        "input": { "type": "object", "properties": {} },
        "output": { "$ref": "#/types/TodoList" }
      }
    }
  ],
  "view": {
    "component": {
      "type": "local",
      "path": "./view/index.html"
    },
    "fallback": "table"
  },
  "types": {
    "Todo": {
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "text": { "type": "string" },
        "done": { "type": "boolean" }
      }
    }
  },
  "permissions": {
    "fileAccess": ["./data/**/*.json"],
    "maxExecutionTime": 5000
  }
}
```

## 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `lavs` | string | 是 | 协议版本，当前 `"1.0"` |
| `name` | string | 是 | bundle 名称（标识符） |
| `contentType` | string | 否 | content-type 标识（如 `lavs/todo-list`），默认等于 `name` |
| `version` | string | 是 | bundle 版本（semver） |
| `description` | string | 否 | 人类可读描述 |
| `endpoints` | array | 是 | 端点列表，见下 |
| `view` | object | 否 | view 组件配置，见下 |
| `types` | object | 否 | 命名 JSON Schema 类型，供 `$ref` 引用 |
| `permissions` | object | 否 | 权限声明，见下 |

## Endpoint

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 端点标识符（如 `addTodo`） |
| `method` | string | 是 | `query` / `mutation` / `subscription` |
| `description` | string | 否 | 端点描述（Agent 可见） |
| `handler` | object | 是 | 执行配置，见下 |
| `schema` | object | 否 | 输入输出 JSON Schema |

### method 类型

| method | 语义 | 是否通知 host 刷新 |
|---|---|---|
| `query` | 读，无副作用 | 否 |
| `mutation` | 写，有副作用 | ✅ 是 |
| `subscription` | 实时推送 | n/a |

## Handler 类型

### script

执行 CLI 命令。

```json
{
  "type": "script",
  "command": "node",
  "args": ["scripts/add.js"],
  "input": "stdin",
  "cwd": "./"
}
```

| 字段 | 说明 |
|---|---|
| `command` | 可执行命令（`node` / `python` / 自定义脚本路径） |
| `args` | 命令参数 |
| `input` | 输入传递方式：`stdin`（JSON via stdin）/ `args`（命令行参数）/ 省略 |
| `cwd` | 工作目录（可选，相对 manifest 解析） |

stdout 的最后一个 JSON 值作为返回结果。

### function

调用 JS/TS 函数（仅 TS runtime）。

```json
{
  "type": "function",
  "module": "./handlers.js",
  "export": "addTodo"
}
```

### http

代理到外部 HTTP 端点（仅 TS runtime）。

```json
{
  "type": "http",
  "url": "https://api.example.com/todos",
  "method": "POST",
  "timeout": 5000
}
```

### mcp

桥接外部 MCP server 工具（仅 TS runtime）。需配套 `mcp-config.json`。

```json
{
  "type": "mcp",
  "server": "my-server",
  "tool": "create_todo"
}
```

## view

```json
{
  "view": {
    "component": {
      "type": "local",
      "path": "./view/index.html"
    },
    "fallback": "table"
  }
}
```

| 字段 | 说明 |
|---|---|
| `component.type` | 当前仅 `"local"` |
| `component.path` | view HTML 文件路径（相对 manifest） |
| `fallback` | 无自定义 view 时的兜底渲染：`table` / `json` |

View 在 iframe 内运行，经 `postMessage` 与 host 通信。LAVS 注入全局变量：
- `window.LAVS_AGENT_ID`
- `window.LAVS_PROJECT_PATH`

## permissions

```json
{
  "permissions": {
    "fileAccess": ["./data/**/*.json"],
    "networkAccess": ["*.example.com"],
    "maxExecutionTime": 5000,
    "maxMemory": "100MB"
  }
}
```

| 字段 | 强制度 | 说明 |
|---|---|---|
| `fileAccess` | 建议 | glob 模式，声明可访问路径 |
| `networkAccess` | 建议 | 声明可访问网络 |
| `maxExecutionTime` | **强制** | 超时毫秒数，超时 kill |
| `maxMemory` | 建议 | 内存上限声明 |

::: warning
除 `maxExecutionTime` 外的权限是**建议级**，不做 OS 强制。详见[安全模型](../spec/overview#安全模型)。
:::

## JSON Schema

完整的机器可读 schema 在仓库内：

- [`schema/lavs-manifest.schema.json`](https://github.com/jeffkit/lavs/blob/main/schema/lavs-manifest.schema.json) —— 可用于 IDE 自动补全
