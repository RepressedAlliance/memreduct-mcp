# Records how much memory AI agents (Claude, Codex and everything they start) hold over
# time, and every Mem Reduct clean with what it gave back. Only process names and memory
# figures are recorded: no command lines, window titles, paths or conversation content.
#
# Runs as one long-lived process (started at logon by the scheduled task from
# Install-Monitor.ps1, which also restarts it within 5 minutes if it ever stops).
# Data goes to %USERPROFILE%\.memreduct-mcp\monitor as daily JSON Lines files.
param(
  [int]$SampleSeconds = 60,
  [int]$PollSeconds = 3,
  # Not under AppData: Windows redirects AppData writes from processes that run inside a
  # Store (MSIX) app's package, such as tools started by the Claude desktop app.
  [string]$DataDir = (Join-Path $env:USERPROFILE '.memreduct-mcp\monitor'),
  # Optional: another tool's record of its own hotkey cleans (a JSON file it rewrites on
  # every clean), so those cleans are attributed to it instead of "user or other program".
  [string]$OtherToolStateFile = '',
  [string]$OtherToolName = 'other tool'
)
$ErrorActionPreference = 'Stop'
$Version = 1
$FollowUpMinutes = 2, 5, 15

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$errorLog = Join-Path $DataDir 'errors.log'
function Write-ErrorLog([string]$Message) {
  try { Add-Content -LiteralPath $errorLog -Value "$((Get-Date).ToString('o')) $Message" -Encoding utf8 } catch { }
}

# One monitor per user session, however it was started.
$mutex = [System.Threading.Mutex]::new($false, 'Local\memreduct-agent-ram-monitor')
try { if (-not $mutex.WaitOne(0)) { exit 0 } } catch [System.Threading.AbandonedMutexException] { }

function Append-Record([string]$Kind, [hashtable]$Record) {
  $Record.t = (Get-Date).ToString('o')
  $Record.kind = $Kind
  $prefix = 'events'; if ($Kind -eq 'sample') { $prefix = 'samples' }
  $file = Join-Path $DataDir ("{0}-{1}.jsonl" -f $prefix, (Get-Date).ToString('yyyy-MM-dd'))
  [IO.File]::AppendAllText($file, ($Record | ConvertTo-Json -Compress -Depth 5) + "`n", $utf8)
}
$utf8 = [Text.UTF8Encoding]::new($false)

# --- Memory sampling ---------------------------------------------------------------
$memCounters = @{
  available = [System.Diagnostics.PerformanceCounter]::new('Memory', 'Available MBytes')
  committed = [System.Diagnostics.PerformanceCounter]::new('Memory', 'Committed Bytes')
  limit     = [System.Diagnostics.PerformanceCounter]::new('Memory', 'Commit Limit')
}
$totalMB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)

function Get-SystemMemory {
  [ordered]@{
    availableMB = [int]$memCounters.available.NextValue()
    committedMB = [math]::Round($memCounters.committed.NextValue() / 1MB)
    commitLimitMB = [math]::Round($memCounters.limit.NextValue() / 1MB)
  }
}

# Each process belongs to the agent its oldest claude/codex ancestor (or itself) names.
# A parent counts only if it was created before the child, so reused PIDs don't link
# unrelated processes.
$agentNames = @{ 'claude.exe' = 'claude'; 'codex.exe' = 'codex' }
function Get-AgentMemory {
  $procs = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount, CreationDate
  $byId = @{}
  foreach ($p in $procs) { $byId[[int]$p.ProcessId] = $p }
  $groups = [ordered]@{
    claude = [ordered]@{ processes = 0; workingSetMB = 0.0; privateMB = 0.0 }
    codex  = [ordered]@{ processes = 0; workingSetMB = 0.0; privateMB = 0.0 }
  }
  foreach ($p in $procs) {
    $owner = $null
    $cur = $p
    for ($depth = 0; $cur -and $depth -lt 64; $depth++) {
      $name = $agentNames[$cur.Name.ToLowerInvariant()]
      if ($name) { $owner = $name }
      $parent = $byId[[int]$cur.ParentProcessId]
      if (-not $parent -or $parent.ProcessId -eq $cur.ProcessId -or
          ($parent.CreationDate -and $cur.CreationDate -and $parent.CreationDate -gt $cur.CreationDate)) { break }
      $cur = $parent
    }
    if ($owner) {
      $g = $groups[$owner]
      $g.processes++
      $g.workingSetMB += $p.WorkingSetSize / 1MB
      $g.privateMB += $p.PrivatePageCount / 1MB
    }
  }
  foreach ($g in $groups.Values) {
    $g.workingSetMB = [math]::Round($g.workingSetMB)
    $g.privateMB = [math]::Round($g.privateMB)
  }
  $all = ($procs | Measure-Object WorkingSetSize -Sum).Sum
  [ordered]@{
    agents = $groups
    allProcessesWorkingSetMB = [math]::Round($all / 1MB)
    memreductRunning = [bool]($procs | Where-Object { $_.Name -ieq 'memreduct.exe' })
  }
}

function Get-FullSample {
  $s = Get-SystemMemory
  $a = Get-AgentMemory
  foreach ($k in $a.Keys) { $s[$k] = $a[$k] }
  $s
}

# --- Clean detection ---------------------------------------------------------------
# Mem Reduct appends one UTF-16LE line per clean to memreduct_debug.log when
# "Log cleaning results into a debug log" is on, e.g.
# "Info","3/11/2026 8:00:42 PM","Cleanup (Auto)","0x00000000","5.60 GB","3.5.2",...
# Without the log, a changed StatisticLastReduct in memreduct.ini still marks a clean.
$mrDir = Join-Path $env:APPDATA 'Henry++\Mem Reduct'
$iniPath = Join-Path $mrDir 'memreduct.ini'
$logPath = Join-Path $mrDir 'memreduct_debug.log'
$mcpState = Join-Path ([IO.Path]::GetTempPath()) 'memreduct-mcp-state.json'
$mcpState2 = Join-Path $env:LOCALAPPDATA 'Temp\memreduct-mcp-state.json'

function Read-Utf16([string]$Path) {
  $fs = [IO.FileStream]::new($Path, 'Open', 'Read', 'ReadWrite, Delete')
  try {
    $buf = [byte[]]::new($fs.Length); $read = 0
    while ($read -lt $buf.Length) { $n = $fs.Read($buf, $read, $buf.Length - $read); if ($n -le 0) { break }; $read += $n }
  } finally { $fs.Dispose() }
  $start = 0; if ($read -ge 2 -and $buf[0] -eq 0xFF -and $buf[1] -eq 0xFE) { $start = 2 }
  [Text.Encoding]::Unicode.GetString($buf, $start, $read - $start)
}

function Get-LastReduct {
  if (-not (Test-Path -LiteralPath $iniPath)) { return $null }
  $m = [regex]::Match((Read-Utf16 $iniPath), '(?m)^StatisticLastReduct=(\d+)')
  if ($m.Success) { [long]$m.Groups[1].Value } else { $null }
}

function Get-CleanLines {
  if (-not (Test-Path -LiteralPath $logPath)) { return @() }
  @((Read-Utf16 $logPath) -split "`r?`n" | Where-Object { $_ -like '"Info",*Cleanup (*' })
}

# Which tool pressed the hotkey: memreduct-mcp records its last clean in a state file
# (as may another tool); a record written within a minute of the clean names the source.
function Get-HotkeySource {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  # memreduct-mcp 0.2 and later: one state file, naming who asked (the agent or a hook).
  try {
    $state = Get-Content -LiteralPath (Join-Path (Split-Path $DataDir) 'state.json') -Raw | ConvertFrom-Json
    if ($state.pressAt -and [math]::Abs($now - $state.pressAt) -lt 60000) { return "memreduct-mcp ($($state.by))" }
  } catch { }
  # Agents that are Store (MSIX) apps, such as the Claude and Codex desktop apps, may have
  # their MCP servers' temp files redirected into the app's package folder.
  $packaged = @(Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Packages\*\LocalCache\Local\Temp\memreduct-mcp-state.json') -ErrorAction SilentlyContinue | ForEach-Object FullName)
  foreach ($path in @($mcpState, $mcpState2) + $packaged | Select-Object -Unique) {
    try {
      $ms = (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json).lastClean
      if ($ms -and [math]::Abs($now - $ms) -lt 60000) { return 'memreduct-mcp' }
    } catch { }
  }
  try {
    if ($OtherToolStateFile -and (Test-Path -LiteralPath $OtherToolStateFile) -and
        ((Get-Date) - (Get-Item -LiteralPath $OtherToolStateFile).LastWriteTime).TotalSeconds -lt 60) { return $OtherToolName }
  } catch { }
  'hotkey (user or other program)'
}

function Get-CleanEvent([string]$Line) {
  $f = $Line.Trim('"') -split '","'
  $reason = ($f[2] -replace '^Cleanup \((.*)\)$', '$1')
  $source = "Mem Reduct ($reason)"
  if ($reason -eq 'Hotkey') { $source = Get-HotkeySource }
  [ordered]@{
    memreductTime = $f[1]
    trigger = $reason
    source = $source
    memreductReported = $f[4]
  }
}

# --- Main loop ---------------------------------------------------------------------
$pendingPath = Join-Path $DataDir 'pending-followups.json'
$pending = [System.Collections.Generic.List[object]]::new()
if (Test-Path -LiteralPath $pendingPath) {
  try { foreach ($p in (Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json)) { $pending.Add($p) } } catch { Write-ErrorLog "pending file unreadable: $_" }
}
function Save-Pending {
  $json = '[' + (($pending | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join ',') + ']'
  [IO.File]::WriteAllText($pendingPath, $json, $utf8)
}

$started = Get-Date
$lastSample = [datetime]::MinValue
$BeforeMarginSeconds = 10
$fullHistory = [System.Collections.Generic.List[object]]::new()
$quickHistory = [System.Collections.Generic.List[object]]::new()
$lastPollAt = Get-Date
$lastReduct = Get-LastReduct
$cleanLineCount = (Get-CleanLines).Count
$errorCount = 0
Append-Record 'monitor' @{ event = 'start'; version = $Version; pid = $PID; sampleSeconds = $SampleSeconds }

$stopRequest = Join-Path $DataDir 'stop-request'
while ($true) {
  # Uninstall-Monitor.ps1 and tests ask the monitor to exit this way, since the process a
  # scheduled task starts can't always be ended from another program's context.
  if (Test-Path -LiteralPath $stopRequest) {
    Remove-Item -LiteralPath $stopRequest -ErrorAction SilentlyContinue
    Append-Record 'monitor' @{ event = 'stop-request' }
    break
  }
  try {
    $now = Get-Date
    # A long gap between polls means the PC slept or hibernated; record it so reports
    # show the hole instead of drawing a line across it.
    if (($now - $lastPollAt).TotalSeconds -gt [math]::Max(120, $PollSeconds * 20)) {
      Append-Record 'monitor' @{ event = 'resume'; gapSeconds = [int]($now - $lastPollAt).TotalSeconds }
    }
    $lastPollAt = $now

    # Clean detection every few seconds, so the "before" figures are close to the clean.
    $reduct = Get-LastReduct
    $lines = Get-CleanLines
    if ($lines.Count -lt $cleanLineCount) { $cleanLineCount = 0 }  # log was cleared or rotated
    $newLines = @($lines | Select-Object -Skip $cleanLineCount)
    $cleanLineCount = $lines.Count
    if ($newLines.Count -eq 0 -and $reduct -and $reduct -ne $lastReduct) {
      # Clean without a log line (result log off): record it with what we know.
      $newLines = @('"Info","","Cleanup (unknown)","","",""')
    }
    if ($reduct) { $lastReduct = $reduct }
    $quick = Get-SystemMemory
    $quickHistory.Add([pscustomobject]@{ at = Get-Date; mem = $quick })
    while ($quickHistory.Count -gt 0 -and ((Get-Date) - $quickHistory[0].at).TotalSeconds -gt 300) { $quickHistory.RemoveAt(0) }
    if ($newLines.Count -gt 0) {
      $after = Get-FullSample
      # Mem Reduct logs a clean when it has finished, and a clean takes a few seconds, so
      # "before" is the newest reading taken at least $BeforeMarginSeconds earlier.
      $cutoff = (Get-Date).AddSeconds(-$BeforeMarginSeconds)
      $beforeFull = $fullHistory | Where-Object { $_.at -le $cutoff } | Select-Object -Last 1
      $beforeQuick = $quickHistory | Where-Object { $_.at -le $cutoff } | Select-Object -Last 1
      foreach ($line in $newLines) {
        $ev = Get-CleanEvent $line
        $id = [guid]::NewGuid().ToString('n').Substring(0, 12)
        $rec = @{
          id = $id
          memreductTime = $ev.memreductTime
          trigger = $ev.trigger
          source = $ev.source
          memreductReported = $ev.memreductReported
          before = $null; beforeAgeSeconds = $null; beforeSystem = $null; beforeSystemAgeSeconds = $null
          after = $after
        }
        if ($beforeFull) { $rec.before = $beforeFull.sample; $rec.beforeAgeSeconds = [int]((Get-Date) - $beforeFull.at).TotalSeconds }
        if ($beforeQuick) { $rec.beforeSystem = $beforeQuick.mem; $rec.beforeSystemAgeSeconds = [int]((Get-Date) - $beforeQuick.at).TotalSeconds }
        Append-Record 'clean' $rec
        foreach ($m in $FollowUpMinutes) { $pending.Add([pscustomobject]@{ id = $id; minutes = $m; due = (Get-Date).AddMinutes($m).ToString('o') }) }
      }
      Save-Pending
    }

    # Follow-ups: how much of the freed memory is still free after 2, 5 and 15 minutes.
    $due = @($pending | Where-Object { [datetime]$_.due -le (Get-Date) })
    if ($due.Count -gt 0) {
      $s = Get-FullSample
      foreach ($d in $due) {
        Append-Record 'followup' @{ cleanId = $d.id; minutes = $d.minutes; lateSeconds = [int]((Get-Date) - [datetime]$d.due).TotalSeconds; sample = $s }
        [void]$pending.Remove($d)
      }
      Save-Pending
    }

    if (((Get-Date) - $lastSample).TotalSeconds -ge $SampleSeconds) {
      $lastSample = Get-Date
      $full = Get-FullSample
      $fullHistory.Add([pscustomobject]@{ at = $lastSample; sample = $full })
      while ($fullHistory.Count -gt 5) { $fullHistory.RemoveAt(0) }
      Append-Record 'sample' @{ sample = $full }
      $self = Get-Process -Id $PID
      [ordered]@{
        version = $Version; pid = $PID; started = $started.ToString('o'); lastSample = $lastSample.ToString('o')
        selfWorkingSetMB = [math]::Round($self.WorkingSet64 / 1MB); errors = $errorCount; dataDir = $DataDir
      } | ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText((Join-Path $DataDir 'heartbeat.json'), $_, $utf8) }
      # Guard against slow growth over weeks: exit and let the scheduled task start a fresh copy.
      if ($self.WorkingSet64 -gt 400MB) { Append-Record 'monitor' @{ event = 'restart-self'; workingSetMB = [math]::Round($self.WorkingSet64 / 1MB) }; break }
    }
  } catch {
    $errorCount++
    Write-ErrorLog "$($_.Exception.Message) at $($_.InvocationInfo.ScriptLineNumber)"
    Start-Sleep -Seconds 5
  }
  Start-Sleep -Seconds $PollSeconds
}
$mutex.ReleaseMutex()
