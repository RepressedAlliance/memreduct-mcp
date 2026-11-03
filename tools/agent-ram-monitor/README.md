# Agent RAM monitor

Records, on your own PC, how much memory AI agents hold over a working day and what each Mem Reduct clean gives back. It was written to answer "does letting agents clean RAM actually help?" with real usage data instead of a staged test.

## What it records

Every 60 seconds:

- the working set and private commit of every process that belongs to **Claude** (`claude.exe` and everything it started: MCP servers, shells, Node and Python children) and to **Codex** (`codex.exe` and its children);
- system available RAM, commit charge and commit limit;
- whether Mem Reduct is running.

For every Mem Reduct clean (detected within 3 seconds from Mem Reduct's result log, or from `StatisticLastReduct` in its ini when the log is off):

- what triggered it: Mem Reduct's own automatic clean, a hotkey clean by memreduct-mcp (matched by the time in its state file), a hotkey clean by another tool that records its own cleans, or a hotkey press by the user or another program;
- Mem Reduct's reported amount, and the readings just before (at least 10 seconds before Mem Reduct logged the clean, since a clean takes a few seconds) and right after;
- the same readings again 2, 5 and 15 minutes later, to show how much of the freed memory stays free.

It records no command lines, window titles, file paths or conversation content. Data stays in `%LOCALAPPDATA%\memreduct-mcp\monitor` as daily JSON Lines files (about 0.5 MB a day).

## Install

```powershell
pwsh -File tools\agent-ram-monitor\Install-Monitor.ps1
```

This registers a scheduled task for the current user (no administrator rights): it starts the monitor at logon and every 5 minutes starts it again if it has stopped; the monitor itself allows only one copy. It runs through `conhost --headless`, so no window appears. Sleep and hibernation leave gaps, which the data marks.

## Check and report

```powershell
pwsh -File tools\agent-ram-monitor\status.ps1     # running? last sample, coverage, cleans, errors
node tools\agent-ram-monitor\report.mjs           # summary, plus report.html with a timeline
```

The report lists every clean, including the ones that freed little, and medians by trigger.

## Remove

```powershell
pwsh -File tools\agent-ram-monitor\Uninstall-Monitor.ps1
```

The recorded data is kept; delete the folder above if you no longer want it.
