# Stops the agent RAM monitor and removes its scheduled task. Recorded data is kept.
$ErrorActionPreference = 'Stop'
$taskName = 'memreduct-agent-ram-monitor'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
$hb = Join-Path $env:USERPROFILE '.memreduct-mcp\monitor\heartbeat.json'
if (Test-Path -LiteralPath $hb) {
  $monitorPid = (Get-Content -LiteralPath $hb -Raw | ConvertFrom-Json).pid
  Get-Process -Id $monitorPid -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in 'powershell', 'pwsh' } | Stop-Process
}
"Removed. Data kept in $(Split-Path $hb)."
