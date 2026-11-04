# Changelog

## 0.2.0 (unreleased)

An agent with 0.1.1's instructions still never cleaned on its own in a 14-hour job, so cleaning no longer depends on the agent remembering to.

- Claude Code plugin hooks: clean before heavy work when under 25% available and after out-of-memory failures; tell the agent when under 15%; clean at the next step under 6%; say so when a clean did not hold instead of cleaning again. Thresholds are configurable, and `MEMREDUCT_MCP_HOOKS=off` disables the hooks.
- `clean_memory` with `needed_mb` now returns `fits`, and advice when the job still won't fit.
- Cooldown and a clean lock are shared by all sessions, in `%USERPROFILE%\.memreduct-mcp`.
- The agent RAM monitor records whether a clean came from the agent or a hook.

## 0.1.1 (2026-11-03)

- The server now tells every client when to clean (MCP `instructions`), so agents in Codex, Cursor and other clients use it on their own, not only Claude Code with the bundled skill. Claude Code adds it to the system prompt; Codex shows it as the description of the server's tools.
- `clean_memory`'s description and the skill say to clean without asking first, and also after commands slow down or time out while RAM is low.
- An empty, negative or non-numeric `MEMREDUCT_MCP_COOLDOWN` (such as an unexpanded config placeholder) falls back to 120 s instead of turning the cooldown off.
- New `tools/agent-ram-monitor` (in the repository, not the npm package): records agents' memory use and every Mem Reduct clean on your PC, to see what cleaning gives back in real use.

## 0.1.0 (2026-11-02)

First release.

- MCP server with three tools: `memory_status`, `clean_memory` and `memreduct_setup_check`.
- Cleans by pressing Mem Reduct's clean hotkey, so it works from an unelevated agent and shows no dialog. A clean counts only after Mem Reduct records it in `StatisticLastReduct`.
- `clean_memory` returns available RAM before and after, and Mem Reduct's own figure when its result log is on. It has a cooldown (`MEMREDUCT_MCP_COOLDOWN`, default 120 s) and skips the clean when `needed_mb` is already free.
- Claude Code plugin with a skill that tells Claude to clean only before memory-hungry jobs.
- Available from the plugin marketplace in this repository, from npm (`npx -y memreduct-mcp`) and as a `.mcpb` extension for Claude Desktop.
