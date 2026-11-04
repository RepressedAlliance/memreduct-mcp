# memreduct-mcp

Let AI agents (Claude Code, Codex, Cursor, Claude Desktop…) free RAM on Windows with **your own [Mem Reduct](https://github.com/henrypp/memreduct)**, so a model, render or build that needs memory right now can get it, without admin prompts and without dialogs to click away.

[中文说明](README.zh-CN.md)

## Why

AI agents on Windows run long jobs on their own: builds, model inference, renders, many sessions and MCP servers side by side. Memory fills up along the way, and an agent has no way to give it back: idle sessions keep their pages resident, and trimming other programs' memory needs administrator rights the agent doesn't have. Mem Reduct can do it, but only when a person clicks it.

memreduct-mcp closes that gap: the Mem Reduct you already run cleans at the moments an agent needs it, and the agent is told what happened.

## How it works

Mem Reduct already runs elevated in your tray. This server presses Mem Reduct's **clean memory hotkey**. Windows delivers registered hotkeys to the elevated Mem Reduct even from an unelevated agent, so no UAC prompt, scheduled task or admin service is involved. The server then waits until Mem Reduct records the clean (`StatisticLastReduct` in its ini) and measures available RAM before and after.

A hotkey clean shows no confirmation and no modal dialog. That is why this server does not use `memreduct.exe -clean`: the command line always ends with a message box that someone has to click.

This project does not include Mem Reduct. Mem Reduct is GPL-3.0 software by Henry++; this server only presses its hotkey.

## When it cleans

Agents can't feel memory pressure, and written guidance alone isn't enough: in a 14-hour video job, an agent with this server's instructions never cleaned on its own, while the PC spent 75 minutes under 1 GB available. So in Claude Code the plugin also ships hooks, which run at each agent step:

| Moment | What happens |
|---|---|
| Before heavy work (subagents, workflows, background jobs, builds, renders), under 25% available | Cleans first. Measured gains fade within minutes under load, so this is the moment that counts. |
| A tool fails with an out-of-memory error (not GPU memory) | Cleans and tells the agent a retry is reasonable. |
| Under 15% for at least 30 seconds | Tells the agent the figures and the largest processes. Once per session, again after recovery or after 15 minutes. |
| Under 6% | Cleans at the next step. |
| Low again within 5 minutes of a clean | Doesn't clean again. Tells the agent the clean didn't hold, so it should lower parallelism, wait, or tell you. |

All sessions share one lock and cooldown. Hooks only run while an agent is working, so for the hours when none is, also set Mem Reduct's own *clean when usage is above* to about 92%.

Set `MEMREDUCT_MCP_NEED_PCT`, `MEMREDUCT_MCP_WARN_PCT`, `MEMREDUCT_MCP_CRITICAL_PCT` or `MEMREDUCT_MCP_REARM_PCT` to change the thresholds, and `MEMREDUCT_MCP_HOOKS=off` to turn the hooks off. What the hooks did is logged to `%USERPROFILE%\.memreduct-mcp\hook-log.jsonl` (memory figures, tool names and session ids only).

Other clients get the tools and the server's instructions, and no hooks yet, so whether the agent cleans on its own is up to the agent.

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

The server itself tells Codex when to clean. For the longer version Claude Code gets, also copy [`skills/memreduct/SKILL.md`](skills/memreduct/SKILL.md) to `%USERPROFILE%\.codex\skills\memreduct\SKILL.md` (optional; new Codex sessions pick it up).

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

Only at the right moment. Cleaning trims every program's working set and drops the standby cache, so available RAM jumps. How much depends on how much idle memory programs are holding. On a 16 GB test laptop, a process holding 6 GB of idle memory brought available RAM down to 3.6 GB; one `clean_memory` call brought it back to 10.9 GB (Mem Reduct's log: "Cleanup (Hotkey), 7.72 GB"). Right after a previous clean, with 10 GB already free, the same call freed under 1 GB.

Idle agent sessions are where it holds up best. With 8 long-lived Claude Code sessions (40 processes with their MCP servers) left idle after some work, one clean took their working set from 2.81 GB to 0.42 GB, and five minutes later they were at 1.02 GB. Their commit charge stayed at about 4 GB: cleaning frees physical RAM, it does not end processes or lower the commit charge.

Programs read those pages back from disk when they touch them again, so cleaning does not make a PC faster in general. It helps when a memory-hungry job is about to start and won't fit. The tool's cooldown and the bundled skill steer agents toward that use and away from cleaning on a schedule.

## Limits

- Windows only, and Mem Reduct must be running.
- Windows blocks simulated key presses while an elevated window (for example Task Manager) has keyboard focus, or while the PC is locked. `clean_memory` then reports `cleaned: false` with a hint.
- If another program grabs the same hotkey, the clean won't happen; choose a different combination.

## Development

```
npm install
npm run build   # bundles src/ into dist/index.cjs
npm test        # end-to-end: starts the server and really cleans memory
npm run test:policy  # the hooks' decisions, without touching memory
npm run pack:mcpb  # builds memreduct-mcp.mcpb for Claude Desktop
```

## License

MIT
