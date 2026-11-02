# Changelog

## 0.1.0 (2026-11-02)

First release.

- MCP server with three tools: `memory_status`, `clean_memory` and `memreduct_setup_check`.
- Cleans by pressing Mem Reduct's clean hotkey, so it works from an unelevated agent and shows no dialog. A clean counts only after Mem Reduct records it in `StatisticLastReduct`.
- `clean_memory` returns available RAM before and after, and Mem Reduct's own figure when its result log is on. It has a cooldown (`MEMREDUCT_MCP_COOLDOWN`, default 120 s) and skips the clean when `needed_mb` is already free.
- Claude Code plugin with a skill that tells Claude to clean only before memory-hungry jobs.
- Available from the plugin marketplace in this repository, from npm (`npx -y memreduct-mcp`) and as a `.mcpb` extension for Claude Desktop.
