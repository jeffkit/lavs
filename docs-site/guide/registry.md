# Bundle 注册表

> 官方 bundle 与社区 bundle 目录。第三方作者可通过 PR 登记，让更多用户发现你的 bundle。

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

> 暂无社区 bundle。欢迎提交！→ [如何登记](#如何登记)

---

## contentType 命名规范

```
<vendor>/<name>
```

- `vendor`：作者域名前缀、组织名或 npm 用户名（全小写，短横线）
- `name`：bundle 功能标识（全小写，短横线）
- 示例：`acme/kanban`、`jeffkit/pomodoro`

**官方保留前缀：** `lavs/` — 仅由本仓 maintainer 使用。

---

## npm 包命名规范

以 npm 包形式分发时，建议：

```
lavs-bundle-<vendor>-<name>
```

示例：`lavs-bundle-acme-kanban`

---

## 如何登记

1. 确保 bundle 满足登记要求：
   - 源码可访问（公开 git 仓库或 npm 包）
   - `lavs validate` 通过
   - contentType 不使用 `lavs/` 前缀
   - 有 README（含端点列表、依赖说明）

2. Fork [jeffkit/lavs](https://github.com/jeffkit/lavs)，编辑根目录 `REGISTRY.md` 的「社区 Bundle」表格，加一行：

   ```markdown
   | `vendor/name` | `lavs-bundle-xxx` | @你的GitHub | 一句话说明 |
   ```

3. 发 PR，maintainer 审核后合并。

::: tip 同步更新
登记之后，本文档页面会随 PR 合并自动同步更新（文档站通过 GitHub Actions 部署）。
:::

::: warning 安全提示
本注册表不对社区 bundle 的安全性做背书。使用前请检查 `scripts/` 代码；不可信 bundle 建议用 Docker 隔离运行。
:::
