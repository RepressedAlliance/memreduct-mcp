# Is the monitor healthy? Prints whether it runs, when it last sampled, coverage over the
# last 24 hours, cleans recorded and any errors. Exit code 0 = healthy, 1 = needs attention.
# Works in Windows PowerShell 5.1 and PowerShell 7.
param([string]$DataDir = (Join-Path $env:LOCALAPPDATA 'memreduct-mcp\monitor'))
$ErrorActionPreference = 'Stop'
$problems = New-Object System.Collections.Generic.List[string]

$task = Get-ScheduledTask -TaskName 'memreduct-agent-ram-monitor' -ErrorAction SilentlyContinue
if (-not $task) { $problems.Add('Scheduled task memreduct-agent-ram-monitor is not installed, so the monitor will not start after a restart (run Install-Monitor.ps1).') }
elseif ($task.State -eq 'Disabled') { $problems.Add('Scheduled task is disabled.') }

$hbPath = Join-Path $DataDir 'heartbeat.json'
$hb = $null
if (Test-Path -LiteralPath $hbPath) { $hb = Get-Content -LiteralPath $hbPath -Raw | ConvertFrom-Json }
$running = $false
if ($hb) { $running = [bool](Get-Process -Id $hb.pid -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in 'powershell', 'pwsh' }) }
if (-not $running) { $problems.Add('Monitor process is not running.') }
$age = $null
if ($hb) { $age = [int]((Get-Date) - [datetime]$hb.lastSample).TotalSeconds }
if ($null -eq $age) { $problems.Add('No sample recorded yet.') } elseif ($age -gt 180) { $problems.Add("Last sample is $age s old.") }

$since = (Get-Date).AddHours(-24)
$samples = 0; $cleans = @{}; $resumes = 0; $gapSeconds = 0
foreach ($file in Get-ChildItem -LiteralPath $DataDir -Filter '*.jsonl' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $since }) {
  foreach ($line in Get-Content -LiteralPath $file.FullName) {
    if (-not $line.Trim()) { continue }
    try { $r = $line | ConvertFrom-Json } catch { continue }
    if ([datetime]$r.t -lt $since) { continue }
    switch ($r.kind) {
      'sample' { $samples++ }
      'clean' { if ($cleans.ContainsKey($r.source)) { $cleans[$r.source]++ } else { $cleans[$r.source] = 1 } }
      'monitor' { if ($r.event -eq 'resume') { $resumes++; $gapSeconds += $r.gapSeconds } }
    }
  }
}
$errorsPath = Join-Path $DataDir 'errors.log'
$recentErrors = @()
if (Test-Path -LiteralPath $errorsPath) { $recentErrors = @(Get-Content -LiteralPath $errorsPath | Where-Object { $_ -match '^(\S+)' -and [datetime]$Matches[1] -ge $since }) }
if ($recentErrors.Count -gt 0) { $problems.Add("$($recentErrors.Count) errors in the last 24 h (see $errorsPath).") }

$monitorLine = 'NOT running'
if ($running) { $monitorLine = "running (pid $($hb.pid), $($hb.selfWorkingSetMB) MB)" }
$sampleLine = 'none'
if ($null -ne $age) { $sampleLine = "$age s ago" }
$cleanLine = 'none'
if ($cleans.Count) { $cleanLine = ($cleans.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name): $($_.Value)" }) -join ', ' }
"Monitor:        $monitorLine"
"Last sample:    $sampleLine"
"Samples (24 h): $samples (sleep/hibernate gaps: $resumes, $([int]($gapSeconds / 60)) min)"
"Cleans (24 h):  $cleanLine"
"Data:           $DataDir"
if ($problems.Count) { ''; 'NEEDS ATTENTION:'; $problems | ForEach-Object { " - $_" }; exit 1 }
''; 'Healthy.'
