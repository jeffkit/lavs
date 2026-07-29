# LAVS Bundle Registry

> 社区 bundle 注册表。第三方作者在此登记 bundle，让用户通过 `lavs install` 或手动 clone 安装。  
> 维护者：jeffkit | 格式以 [贡献说明](#贡献) 为准

---

## 官方 Bundle（随 `lavs-runtime` 内置）

| contentType | 名称 | 说明 |
|---|---|---|
| `lavs/todo-list` | Todo List | 任务管理：CRUD + 优先级 + 标签 + toggle |
| `lavs/daily-note` | Daily Note | 时间序列日记：日期分组、全文搜索 |
| `lavs/data-table` | Data Table | 泛型表格：Agent 推任意列、排序筛选、CSV 导出 |
| `lavs/bookmark` | Bookmark | URL 收藏：标签聚合、卡片布局 |

---

## 社区 Bundle

> 暂无社区 bundle。欢迎提交！→ [贡献说明](#贡献)

<!-- 
格式：
| contentType | 包名 / repo | 作者 | 说明 |
|---|---|---|---|
| `vendor/name` | `lavs-bundle-name` / github.com/... | @user | 一句话说明 |
-->

---

## contentType 命名规范

```
<vendor>/<name>
```

- `vendor`：作者域名前缀、组织名或 npm 用户名（全小写，短横线）
- `name`：bundle 功能标识（全小写，短横线）
- 示例：`acme/kanban`、`jeffkit/pomodoro`、`myorg/issue-tracker`

**官方保留前缀：** `lavs/` — 只由本仓 maintainer 使用。

---

## npm 包命名规范

第三方 bundle 以 npm 包形式分发时，建议包名：

```
lavs-bundle-<vendor>-<name>
```

示例：`lavs-bundle-acme-kanban`、`lavs-bundle-jeffkit-pomodoro`

包的 `main` 或根目录应包含 `lavs.json`，以便 `lavs install` 自动提取。

---

## 贡献

向本注册表提交 bundle，需满足：

1. **有可访问的源码**（公开 git 仓库或 npm 包）
2. **lavs.json 通过 validate**：`lavs validate --agent-dir <dir>` 无错误
3. **声明正确的 contentType**（遵循命名规范，不使用 `lavs/` 前缀）
4. **有 README**：说明 bundle 用途、端点列表、依赖项（Node/Python 版本等）
5. **安全声明**：如果 bundle 需要网络访问或文件写入，在 README 中说明

提交方式：向本仓发 PR，在「社区 Bundle」表格追加一行。格式：

```markdown
| `vendor/name` | `lavs-bundle-xxx` 或 `github.com/you/your-bundle` | @你的GitHub | 一句话说明 |
```

---

## 安全提示

- 第三方 bundle 脚本**未经 LAVS 沙箱保护**（`fileAccess` 是建议级，非 OS 强制）
- 运行不可信 bundle 前，检查 `scripts/` 代码
- 对不可信 bundle 使用 Docker / nsjail 隔离
- 本注册表不对社区 bundle 的安全性做背书

---

*如需了解如何创建和发布 bundle，参见 [docs-site/guide/create-bundle.md](docs-site/guide/create-bundle.md)。*
