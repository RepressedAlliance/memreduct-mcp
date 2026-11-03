# Changelog

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
