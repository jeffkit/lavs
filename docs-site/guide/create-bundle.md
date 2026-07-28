# 编写自己的 Bundle

Bundle 是 LAVS 的可复用单元：一份 `lavs.json` 清单 + handler 实现 + view 组件。
本文教你从零创建一个 bundle，并接入 host。

## Bundle 的四个部分

```
my-bundle/
├── lavs.json          # 清单：声明 contentType、端点、权限
├── scripts/           # handler 实现（script 类型）
│   └── list.js
├── view/
│   └── index.html     # 可视化组件（iframe 内运行）
└── data/              # 数据持久化目录（运行时生成）
```

## 1. 脚手架

```bash
lavs init --agent-dir ./my-bundle
```

生成一个最小 `lavs.json`。在此基础上改。

## 2. 写 lavs.json

一份完整的清单示例：

```json
{
  "lavs": "1.0",
  "name": "my-bundle",
  "contentType": "lavs/my-bundle",
  "version": "1.0.0",
  "description": "我的第一个 bundle",
  "endpoints": [
    {
      "id": "list",
      "method": "query",
      "description": "列出所有条目",
      "handler": {
        "type": "script",
        "command": "node",
        "args": ["scripts/list.js"]
      },
      "schema": {
        "output": { "type": "array", "items": { "type": "object" } }
      }
    },
    {
      "id": "add",
      "method": "mutation",
      "description": "添加条目",
      "handler": {
        "type": "script",
        "command": "node",
        "args": ["scripts/add.js"],
        "input": "stdin"
      },
      "schema": {
        "input": {
          "type": "object",
          "required": ["text"],
          "properties": {
            "text": { "type": "string" }
          }
        }
      }
    }
  ],
  "view": {
    "component": { "type": "local", "path": "./view/index.html" },
    "fallback": "table"
  },
  "permissions": {
    "fileAccess": ["./data/**/*.json"],
    "maxExecutionTime": 5000
  }
}
```

### 关键字段

| 字段 | 说明 |
|---|---|
| `name` | bundle 标识符（短横线命名，如 `my-bundle`） |
| `contentType` | 分发键，建议反向域名风格（如 `lavs/my-bundle`）。省略则等于 `name` |
| `endpoints[].method` | `query`（读）/ `mutation`（写，触发 view 刷新） |
| `endpoints[].handler.input` | `stdin`（JSON 管道）/ `args`（命令行参数）/ 省略（无输入） |
| `view.fallback` | 无自定义 view 时的兜底：`table` / `list` / `json` |

## 3. 写 handler 脚本

script handler 的约定：**stdout 最后一个 JSON 值作为返回结果**。

```javascript
// scripts/list.js
const fs = require('fs');
const path = require('path');

// LAVS_PROJECT_PATH 指向 bundle 目录
const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'items.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return []; }
}

console.log(JSON.stringify(load()));
```

```javascript
// scripts/add.js — mutation，从 stdin 读输入
const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'items.json');

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const { text } = JSON.parse(input);
  let items = [];
  try { items = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch {}
  const item = { id: Date.now(), text, createdAt: new Date().toISOString() };
  items.push(item);
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(items, null, 2));
  console.log(JSON.stringify(item));  // ← stdout 输出结果
});
```

::: tip 数据目录约定
bundle 数据放 `data/` 子目录，用 `LAVS_PROJECT_PATH` 或 `__dirname/../data` 定位。
这保证 dispatch 模式下每个 bundle 数据隔离（`<bundleDir>/data/`）。
:::

## 4. 写 view 组件

view 是一个 HTML 文件，在 iframe 内运行，经 `postMessage` 与 host 通信。

最小模板：

```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>My Bundle</title></head>
<body>
  <div id="content">加载中…</div>
  <script>
    // 调用 LAVS 端点
    function callEndpoint(endpoint, input) {
      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).slice(2);
        const handler = (event) => {
          if (event.data.id !== id) return;
          window.removeEventListener('message', handler);
          if (event.data.type === 'lavs-result') resolve(event.data.result);
          else reject(new Error(event.data.error));
        };
        window.addEventListener('message', handler);
        window.parent.postMessage(
          { type: 'lavs-call', id, endpoint, input: input || {} }, '*'
        );
      });
    }

    // 监听 agent 动作 → 自动刷新
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'lavs-agent-action') {
        render();
      }
    });

    async function render() {
      const items = await callEndpoint('list');
      document.getElementById('content').innerHTML = items
        .map(i => `<div>${i.text}</div>`).join('');
    }

    render();
  </script>
</body>
</html>
```

### postMessage 协议

| 方向 | 消息类型 | 说明 |
|---|---|---|
| view → host | `lavs-call` | 调用端点：`{ type, id, endpoint, input }` |
| host → view | `lavs-result` | 返回结果：`{ type, id, result }` |
| host → view | `lavs-error` | 返回错误：`{ type, id, error }` |
| host → view | `lavs-agent-action` | Agent 执行了 mutation，建议刷新 |

## 5. 验证与运行

```bash
# 校验清单
lavs validate --agent-dir ./my-bundle

# 用 CLI 测试端点
lavs call list --agent-dir ./my-bundle
lavs call add --agent-dir ./my-bundle --input '{"text":"测试"}'

# 放进 registry，用 host 打开
lavs view --registry-dir ./my-bundle       # 单 bundle
lavs view --registry-dir ./bundles          # 多 bundle（含你的）
```

## 参考实现

仓库 `bundles/` 下有 4 个官方 bundle，从简单到复杂：

| Bundle | contentType | 重点学习 |
|---|---|---|
| `todo-list` | `lavs/todo-list` | 完整 CRUD + 优先级 + 标签 + toggle |
| `daily-note` | `lavs/daily-note` | 时间序列数据、按日期分组、全文搜索 |
| `data-table` | `lavs/data-table` | 泛型渲染（Agent 推任意列）、排序筛选、CSV 导出 |
| `bookmark` | `lavs/bookmark` | 外部链接、标签聚合、卡片布局 |

## 发布

Bundle 目前通过 git 仓库分发。推荐做法：

1. 把 bundle 目录作为独立 git 仓库（或 monorepo 子目录）
2. README 里写清 contentType、端点列表、依赖（node 版本等）
3. 用户 clone 后 `lavs view --registry-dir <clone-path>` 即可用

未来 LAVS 计划支持 bundle registry（类似 npm registry），届时可直接 `lavs install <contentType>`。

::: warning 安全提示
运行第三方 bundle 前，检查 `scripts/` 里的代码。LAVS 的 `fileAccess` 权限是建议级（非 OS 强制），恶意 bundle 可能读写声明路径之外的数据。对不可信 bundle 用 Docker / nsjail 沙箱隔离。
:::
