# memreduct-mcp

Let AI agents (Claude Code, Codex, Cursor, Claude Desktop…) free RAM on Windows with **your own [Mem Reduct](https://github.com/henrypp/memreduct)**, so a model, render or build that needs memory right now can get it, without admin prompts and without dialogs to click away.

[中文说明](README.zh-CN.md)

## How it works

Mem Reduct already runs elevated in your tray. This server presses Mem Reduct's **clean memory hotkey**. Windows delivers registered hotkeys to the elevated Mem Reduct even from an unelevated agent, so no UAC prompt, scheduled task or admin service is involved. The server then waits until Mem Reduct records the clean (`StatisticLastReduct` in its ini) and measures available RAM before and after.

A hotkey clean shows no confirmation and no modal dialog. That is why this server does not use `memreduct.exe -clean`: the command line always ends with a message box that someone has to click.

This project does not include Mem Reduct. Mem Reduct is GPL-3.0 software by Henry++; this server only presses its hotkey.

## Tools

| Tool | What it does |
|---|---|
| `memory_status` | Total, available and committed RAM, plus the largest processes. Read-only. |
| `clean_memory` | Triggers a Mem Reduct clean and returns available RAM before and after, `freedMB`, and Mem Reduct's own figure when its result log is on. Optional `needed_mb` skips the clean when that much is already free. Has a cooldown (default 120 s, env `MEMREDUCT_MCP_COOLDOWN`). |
| `memreduct_setup_check` | Says whether Mem Reduct is installed, running and has the hotkey enabled, and what to fix if not. |

## Setup

1. Install [Mem Reduct](https://github.com/henrypp/memreduct/releases), start it (it asks for administrator rights once) and keep it in the tray. Turning on *Load on system startup* keeps it there.
2. In Mem Reduct **Settings > Hotkeys**, enable **Clean memory**. Pick a combination nothing else uses. The default Ctrl+F1 collides with Office's ribbon toggle, so Ctrl+Alt+Shift+F12 is a good choice. The server reads whatever you set.
3. Recommended: in Mem Reduct **Settings > Advanced**, enable **Log cleaning results into a debug log**. `clean_memory` then also returns the amount Mem Reduct itself reports (`memreductReported`), so you don't have to trust the server's own measurement.
4. Optional: turn off the clean-result tray notification if you don't want a balloon after each clean.
5. Requires Node.js 18 or later.

### Claude Code (plugin, includes a skill that tells Claude when to clean)

```
/plugin marketplace add RepressedAlliance/memreduct-mcp
/plugin install memreduct@memreduct-mcp
```

### Codex, Cursor and other MCP clients

The server is on npm as `memreduct-mcp`:

```
codex mcp add memreduct -- npx -y memreduct-mcp
```

In clients configured with JSON (Cursor, Windsurf, Claude Desktop and others), add:

```json
{
  "mcpServers": {
    "memreduct": { "command": "npx", "args": ["-y", "memreduct-mcp"] }
  }
}
```

### Claude Desktop extension

Download `memreduct-mcp.mcpb` from [Releases](https://github.com/RepressedAlliance/memreduct-mcp/releases) and open it, or drag it onto Claude Desktop's **Settings > Extensions** page. The cooldown can be changed in the extension's settings.

### Without npm

Clone the repository; `dist/index.cjs` is a self-contained bundle with no `npm install` needed. Use command `node` with argument `C:\path\to\memreduct-mcp\dist\index.cjs`.

## Is cleaning RAM actually useful?

Only at the right moment. Cleaning trims every program's working set and drops the standby cache, so available RAM jumps. How much depends on how much idle memory programs are holding. On a 16 GB test laptop, a process holding 6 GB of idle memory brought available RAM down to 3.6 GB; one `clean_memory` call brought it back to 10.9 GB (Mem Reduct's log: "Cleanup (Hotkey), 7.72 GB"). Right after a previous clean, with 10 GB already free, the same call freed under 1 GB. Programs read those pages back from disk when they touch them again, so cleaning does not make a PC faster in general. It helps when a memory-hungry job is about to start and won't fit. The tool's cooldown and the bundled skill steer agents toward that use and away from cleaning on a schedule.

## Limits

- Windows only, and Mem Reduct must be running.
- Windows blocks simulated key presses while an elevated window (for example Task Manager) has keyboard focus, or while the PC is locked. `clean_memory` then reports `cleaned: false` with a hint.
- If another program grabs the same hotkey, the clean won't happen; choose a different combination.

## Development

```
npm install
npm run build   # bundles src/ into dist/index.cjs
npm test        # end-to-end: starts the server and really cleans memory
npm run pack:mcpb  # builds memreduct-mcp.mcpb for Claude Desktop
```

## License

MIT
