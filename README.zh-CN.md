# memreduct-mcp

让 AI Agent（Claude Code、Codex、Cursor、Claude Desktop 等）在 Windows 上用**你自己的 [Mem Reduct](https://github.com/henrypp/memreduct)** 腾内存。模型、渲染、编译等任务马上要用内存时，Agent 可以自己清理，不弹管理员确认，也不留需要点掉的对话框。

## 为什么做这个

Windows 上的 AI Agent 经常自己跑长任务：编译、模型推理、渲染，同时开着好几个会话和 MCP 服务。跑着跑着内存就满了，Agent 自己却释放不了：闲置的会话一直占着物理内存，而清理别的程序的内存需要管理员权限，Agent 没有。Mem Reduct 能清，但要有人去点。

memreduct-mcp 补上了这一步：在 Agent 需要的时候，让你已经在用的 Mem Reduct 清理，并告诉 Agent 结果。

## 原理

Mem Reduct 本来就以管理员身份常驻在托盘里。这个服务只是按下 Mem Reduct 的**清理内存快捷键**。即使 Agent 以普通权限运行，Windows 也会把注册过的全局快捷键送到管理员权限的 Mem Reduct，所以不需要 UAC、计划任务或任何提权服务。按完以后，服务会等 Mem Reduct 在配置文件里写下这次清理的时间（`StatisticLastReduct`），再对比清理前后的可用内存。

用快捷键清理时，Mem Reduct 既不弹确认框，也不弹模态对话框。命令行 `memreduct.exe -clean` 则一定会弹出必须点“确定”的对话框，所以这里不用命令行。

本项目不包含 Mem Reduct。Mem Reduct 是 Henry++ 以 GPL-3.0 发布的软件，本项目只负责按它的快捷键。

## 什么时候清理

Agent 感觉不到内存压力，只写说明也不够：在一个跑了 14 小时的视频任务里，带着本服务说明的 Agent 一次都没有主动清理，而电脑有 75 分钟可用内存低于 1 GB。所以在 Claude Code 里，插件还带了 hook，在 Agent 的每一步运行：

| 时机 | 做什么 |
|---|---|
| 重任务开始前（子 Agent、Workflow、后台任务、编译、渲染），可用内存低于 25% | 先清理。实测清理的收益在负载下几分钟就会回吐，所以这一刻最关键。 |
| 工具因内存不足报错（显存不足除外） | 清理，并告诉 Agent 可以重试。 |
| 低于 15% 持续至少 30 秒 | 告诉 Agent 当前数字和占用最多的进程。每个会话提醒一次，恢复后或 15 分钟后再提醒。 |
| 低于 6% | 下一步就清理。 |
| 清理后 5 分钟内又低了 | 不再清理，告诉 Agent 清理没保持住，应该降低并发、等一等或告诉你。 |

所有会话共用一把锁和冷却时间。hook 只在 Agent 工作时运行，所以没有 Agent 在跑的时段，建议把 Mem Reduct 自带的“内存用量超过一定比例时清理”设为约 92%。

用 `MEMREDUCT_MCP_NEED_PCT`、`MEMREDUCT_MCP_WARN_PCT`、`MEMREDUCT_MCP_CRITICAL_PCT`、`MEMREDUCT_MCP_REARM_PCT` 改阈值，`MEMREDUCT_MCP_HOOKS=off` 关闭 hook。hook 做过什么记录在 `%USERPROFILE%\.memreduct-mcp\hook-log.jsonl`（只有内存数字、工具名和会话 ID）。

其他客户端有工具和服务说明，暂时没有 hook，所以 Agent 会不会主动清理取决于它自己。

## 工具

| 工具 | 作用 |
|---|---|
| `memory_status` | 总内存、可用内存、提交量，以及占用最多的进程。只读。 |
| `clean_memory` | 触发 Mem Reduct 清理，返回清理前后的可用内存和 `freedMB`；Mem Reduct 开了结果日志时，再附上它自己报告的清理量。传 `needed_mb` 时，内存已经够用就跳过清理。有冷却时间（默认 120 秒，环境变量 `MEMREDUCT_MCP_COOLDOWN`）。 |
| `memreduct_setup_check` | 检查 Mem Reduct 是否安装、是否在运行、快捷键是否已开启；没准备好时告诉用户怎么改。 |

## 安装

1. 安装并启动 [Mem Reduct](https://github.com/henrypp/memreduct/releases)（第一次会请求管理员权限），让它常驻托盘。建议打开它的“开机启动”。
2. 在 Mem Reduct 的 **设置 > 快捷键** 里启用 **清理内存**，挑一个不和别的软件冲突的组合。默认的 Ctrl+F1 和 Office 的“折叠功能区”冲突，推荐 Ctrl+Alt+Shift+F12。服务会自动读取你设置的组合。
3. 建议：在 Mem Reduct 的 **设置 > 高级** 里勾选 **Log cleaning results into a debug log**。这样 `clean_memory` 还会返回 Mem Reduct 自己报告的清理量（`memreductReported`），不用只信本工具的测量。
4. 可选：关掉清理结果的托盘提示。
5. 需要 Node.js 18 或更高版本。

### Claude Code（插件，附带一份告诉 Claude 何时该清理的 Skill）

```
/plugin marketplace add RepressedAlliance/memreduct-mcp
/plugin install memreduct@memreduct-mcp
```

### Codex、Cursor 等 MCP 客户端

服务已发布到 npm，包名 `memreduct-mcp`：

```
codex mcp add memreduct -- npx -y memreduct-mcp
```

服务本身会告诉 Codex 什么时候该清理。想要 Claude Code 那份更详细的说明，可以再把 [`skills/memreduct/SKILL.md`](skills/memreduct/SKILL.md) 复制到 `%USERPROFILE%\.codex\skills\memreduct\SKILL.md`（可选，新开的 Codex 会话会用上）。

用 JSON 配置的客户端（Cursor、Windsurf、Claude Desktop 等）加上：

```json
{
  "mcpServers": {
    "memreduct": { "command": "npx", "args": ["-y", "memreduct-mcp"] }
  }
}
```

### Claude Desktop 扩展

从 [Releases](https://github.com/RepressedAlliance/memreduct-mcp/releases) 下载 `memreduct-mcp.mcpb`，双击打开，或拖到 Claude Desktop 的 **设置 > 扩展** 页面。冷却时间可以在扩展设置里改。

### 不用 npm

克隆仓库即可。`dist/index.cjs` 是打包好的单文件，不需要 `npm install`。命令填 `node`，参数填 `C:\path\to\memreduct-mcp\dist\index.cjs`。

## 清内存真的有用吗？

只在合适的时机有用。清理会削减所有程序的工作集、丢掉备用缓存，所以可用内存会马上变多，具体多出多少，取决于各程序占着多少暂时不用的内存。在一台 16 GB 的测试笔记本上，让一个进程占着 6 GB 不动，可用内存降到 3.6 GB；调用一次 `clean_memory` 后回到 10.9 GB（Mem Reduct 日志记录：“Cleanup (Hotkey)，7.72 GB”）。如果刚清理过、又已经有 10 GB 空闲，同样的调用只能腾出不到 1 GB。

对闲置的 Agent 会话效果最稳定。让 8 个常驻的 Claude Code 会话（连同 MCP 服务共 40 个进程）干完活后闲着，清理一次，它们的工作集从 2.81 GB 降到 0.42 GB，5 分钟后是 1.02 GB。它们的提交量一直在 4 GB 左右：清理腾出的是物理内存，不会结束进程，也不会降低提交量。

但程序再用到那些页面时，还会从磁盘读回来，所以它不会让电脑整体变快。它真正有用的场景，是马上要开始一个内存吃紧、本来装不下的任务。工具的冷却时间和附带的 Skill，都是为了引导 Agent 只在这种时候清理，不要定时清理。

## 限制

- 只支持 Windows，而且 Mem Reduct 必须在运行。
- 当前台是管理员权限的窗口（比如任务管理器），或者电脑处于锁屏状态时，Windows 会拦下模拟按键。这时 `clean_memory` 会返回 `cleaned: false` 和提示。
- 如果别的软件占用了同一个快捷键，清理不会发生，换一个组合即可。

## 开发

```
npm install
npm run build   # 把 src/ 打包成 dist/index.cjs
npm test        # 端到端测试：启动服务并真正清理一次内存
npm run test:policy  # 测 hook 的决策，不碰内存
npm run pack:mcpb  # 生成给 Claude Desktop 用的 memreduct-mcp.mcpb
```

## 许可证

MIT
