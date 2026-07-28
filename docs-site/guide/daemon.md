# 后台常驻（Daemon）

`lavs daemon` 让 host 作为系统后台服务运行——开机自启、崩溃自动重启。
适合长期使用 LAVS 的桌面开发者。

## 平台支持

| 平台 | 机制 | 状态 |
|---|---|---|
| macOS | launchd（`~/Library/LaunchAgents/com.lavs.host.plist`） | ✅ 已实现 |
| Linux | systemd user service（`~/.config/systemd/user/lavs-host.service`） | ✅ 已实现 |
| Windows | — | ❌ 未实现，建议用 [pm2](https://pm2.keymetrics.io/) |

## 安装

```bash
lavs daemon install \
  --registry-dir ~/my-bundles \
  --registry-dir ~/more-bundles \
  --port 7842
```

安装后立即启动，并注册为开机自启。输出示例：

```
[LAVS daemon] ✅ Installed and started.
  plist: /Users/you/Library/LaunchAgents/com.lavs.host.plist
  port:  7842
  dirs:  /Users/you/my-bundles
  logs:  /tmp/lavs-host.log  (err: /tmp/lavs-host.err)
  url:   http://localhost:7842/
```

## 查看状态

```bash
lavs daemon status
```

输出包含 launchd/systemd 的进程状态 + 端口连通性检查：

```
[LAVS daemon] ✅ Running
  Host at port 7842: responding — 2 bundle(s)
```

## 卸载

```bash
lavs daemon uninstall
```

停止服务、移除开机自启、删除配置文件。

## 崩溃恢复

daemon 配置了 `KeepAlive=true`（macOS）/ `Restart=on-failure`（Linux）。
host 进程异常退出后，系统会在几秒内自动重启。

验证（macOS）：

```bash
# 找到 host 进程
PID=$(launchctl list com.lavs.host | grep PID | awk '{print $3}' | tr -d ';')

# 杀掉
kill -9 $PID

# 几秒后 launchctl 会重新拉起，新 PID 响应正常
launchctl list com.lavs.host | grep PID
curl -s http://127.0.0.1:7842/api/discover | head -c 80
```

## 日志

| 平台 | 日志位置 |
|---|---|
| macOS | `/tmp/lavs-host.log`（stdout）、`/tmp/lavs-host.err`（stderr） |
| Linux | `journalctl --user -u lavs-host -f` |

```bash
tail -f /tmp/lavs-host.log
```

## 端口与通知联动

daemon 启动的 host 会设置 `LAVS_HOST_PORT` 环境变量（写入 plist 的 `EnvironmentVariables` / service 的 `Environment=`）。
这意味着：**即使你改了 daemon 端口，`lavs call` 的 mutation 通知也能正确打到该端口**——通知端口与 host 监听端口自动一致。

```bash
# 装一个跑在 9000 端口的 daemon
lavs daemon install --registry-dir ./bundles --port 9000

# lavs call 会通知到 9000（因为 daemon plist 设了 LAVS_HOST_PORT=9000）
lavs call addTodo --agent-dir ./bundles/todo-list --input '{"text":"ok"}'
```

## 多 daemon 实例

目前一个用户只能装一个 daemon（固定 label `com.lavs.host`）。
若需要多端口多目录，用 `--registry-dir` 聚合到一个 daemon，或前台起额外的 `lavs host`。

## Windows 用户

Windows 暂未原生支持。用 pm2 替代：

```bash
pm2 start "node /path/to/lavs-runtime/dist/cli.js host --no-open" --name lavs-host
pm2 save
pm2 startup
```
