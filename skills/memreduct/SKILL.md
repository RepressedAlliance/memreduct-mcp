---
name: memreduct
description: Free RAM on Windows with the user's Mem Reduct before memory-hungry work (model inference, renders, builds, many parallel agents). Use when a job may not fit in available RAM, or a tool failed with out-of-memory or "low virtual memory" errors.
---

# Freeing RAM with Mem Reduct

The `memreduct` MCP server exposes three tools:

- `memory_status`: available and committed RAM, plus the biggest processes. Read-only, call it freely.
- `clean_memory`: asks the user's running Mem Reduct to clean memory and reports how much RAM it freed. Pass `needed_mb` to skip the clean when that much is already available.
- `memreduct_setup_check`: says whether Mem Reduct is installed, running and has its clean hotkey enabled.

## When to clean

1. Before starting something that needs more RAM than is available, call `memory_status`, then `clean_memory` with `needed_mb` set to the job's needs.
2. After an out-of-memory failure, clean once and retry the job once.

Do not clean on a schedule or "just in case". Cleaning trims every program's working set and drops cached file data, and programs read those pages back from disk when they need them, so frequent cleaning makes the PC slower, not faster. The tool enforces a cooldown for this reason.

## Reporting

Tell the user what you measured: available RAM before and after, and `freedMB`. If the job still will not fit after one clean, say so and suggest closing specific large programs from `memory_status` (ask first; never close programs yourself), or running the job with less parallelism.

## When it is not set up

If `clean_memory` returns `setup` problems, relay them to the user as written. They usually need to:
1. install Mem Reduct, start it and keep it in the tray (it asks for administrator rights once);
2. in Mem Reduct Settings > Hotkeys, enable the "Clean memory" hotkey.

Do not try to elevate, edit Mem Reduct's ini or restart Mem Reduct yourself.
