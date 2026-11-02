# memreduct-mcp

让 AI Agent（Claude Code、Codex、Cursor、Claude Desktop 等）在 Windows 上用**你自己的 [Mem Reduct](https://github.com/henrypp/memreduct)** 腾内存。模型、渲染、编译等任务马上要用内存时，Agent 可以自己清理，不弹管理员确认，也不留需要点掉的对话框。

## 原理

Mem Reduct 本来就以管理员身份常驻在托盘里。这个服务只是按下 Mem Reduct 的**清理内存快捷键**。即使 Agent 以普通权限运行，Windows 也会把注册过的全局快捷键送到管理员权限的 Mem Reduct，所以不需要 UAC、计划任务或任何提权服务。按完以后，服务会等 Mem Reduct 在配置文件里写下这次清理的时间（`StatisticLastReduct`），再对比清理前后的可用内存。

用快捷键清理时，Mem Reduct 既不弹确认框，也不弹模态对话框。命令行 `memreduct.exe -clean` 则一定会弹出必须点“确定”的对话框，所以这里不用命令行。

本项目不包含 Mem Reduct。Mem Reduct 是 Henry++ 以 GPL-3.0 发布的软件，本项目只负责按它的快捷键。

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

只在合适的时机有用。清理会削减所有程序的工作集、丢掉备用缓存，所以可用内存会马上变多，具体多出多少，取决于各程序占着多少暂时不用的内存。在一台 16 GB 的测试笔记本上，让一个进程占着 6 GB 不动，可用内存降到 3.6 GB；调用一次 `clean_memory` 后回到 10.9 GB（Mem Reduct 日志记录：“Cleanup (Hotkey)，7.72 GB”）。如果刚清理过、又已经有 10 GB 空闲，同样的调用只能腾出不到 1 GB。但程序再用到那些页面时，还会从磁盘读回来，所以它不会让电脑整体变快。它真正有用的场景，是马上要开始一个内存吃紧、本来装不下的任务。工具的冷却时间和附带的 Skill，都是为了引导 Agent 只在这种时候清理，不要定时清理。

## 限制

- 只支持 Windows，而且 Mem Reduct 必须在运行。
- 当前台是管理员权限的窗口（比如任务管理器），或者电脑处于锁屏状态时，Windows 会拦下模拟按键。这时 `clean_memory` 会返回 `cleaned: false` 和提示。
- 如果别的软件占用了同一个快捷键，清理不会发生，换一个组合即可。

## 开发

```
npm install
npm run build   # 把 src/ 打包成 dist/index.cjs
npm test        # 端到端测试：启动服务并真正清理一次内存
npm run pack:mcpb  # 生成给 Claude Desktop 用的 memreduct-mcp.mcpb
```

## 许可证

MIT
