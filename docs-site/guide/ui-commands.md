# UI 命令（notify 端点）

UI 命令让 Agent 触发**纯视图层操作**——切换布局、过滤、折叠面板——而不产生任何数据变更。
协议定义见 SPEC §12（v1.2-draft）。

## 动机

`mutation` 解决「数据变了 → 页面刷新」；但视图自己的按钮（换个视图布局、切换过滤器，
这些不落盘的操作）此前对 Agent 不可达。`notify` 端点补上这块，同时保持单向控制：
**Agent 命令视图，视图永远无法反向命令 Agent**。

## 对 Agent 用户：零新概念

`notify` 端点和 query/mutation 一样被生成为工具（CLI 与 MCP 两条通道都可用）：

```bash
# 把 todo 视图切成紧凑布局
lavs call setCompact --agent-dir ./bundles/todo-list --input '{"on":true}'

# 切换过滤器
lavs call setFilter --agent-dir ./bundles/todo-list --input '{"filter":"active"}'
```

MCP 通道下它们就是普通工具：`lavs_setCompact`、`lavs_setFilter`。

## 对 Bundle 作者

### 1. 在 `lavs.json` 声明端点

```json
{
  "id": "setTheme",
  "method": "notify",
  "description": "Switch view theme (dark/light). No data changes.",
  "schema": {
    "input": {
      "type": "object",
      "required": ["theme"],
      "properties": { "theme": { "type": "string", "enum": ["dark", "light"] } }
    }
  }
}
```

`notify` 端点的 `handler` 是**可选**的——纯 UI 命令没有服务端副作用，广播本身就是全部效果。
带 handler 也可以（比如顺带记日志），执行结果会随广播一起带给视图。

### 2. 视图侧用 `@lavs/view` 注册命令

```html
<script src="lavs-view.iife.js"></script>
<script>
  const view = LAVSView.connect({
    refresh: loadItems,                       // 数据变了 → 刷新
    commands: {
      setTheme(args) {                        // 命令名 = 端点 id
        document.body.classList.toggle('light', args.theme === 'light');
      },
    },
  });
</script>
```

`@lavs/view`（npm 包，或直接复制 `dist/lavs-view.iife.js`）封装了 postMessage 桥、
agent-action 路由和命令注册表。**不认识的命令自动回退为刷新**，新旧视图与新旧 bundle
交叉时行为永远正确。

### 广播形状

视图收到的 agent-action：

```json
{
  "type": "lavs-agent-action",
  "action": {
    "type": "ui_command",
    "tool": "lavs_setTheme",
    "command": "setTheme",
    "args": { "theme": "light" },
    "contentType": "lavs/quickstart-demo",
    "timestamp": 1789652011157,
    "result": { "ok": true }
  }
}
```

mutation 的 `tool_executed` 载荷不变。

## 安全要点

- 命令只能从 host 流向 iframe，单向；视图无法借该通道触达 Agent。
- 入参与 mutation 一样在服务端做 schema 校验后才广播。
- 视图必须把 `args` 当不可信输入处理（不要拼接 innerHTML 等）。

## 完整示例

`examples/quickstart/demo` —— 3 个端点（query + mutation + notify）的最小 bundle。
