# Stops the agent RAM monitor and removes its scheduled task. Recorded data is kept.
$ErrorActionPreference = 'Stop'
$taskName = 'memreduct-agent-ram-monitor'
$dataDir = Join-Path $env:USERPROFILE '.memreduct-mcp\monitor'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
# Ask the running monitor to exit; it checks for this file every few seconds.
if (Test-Path -LiteralPath $dataDir) {
  New-Item -ItemType File -Force -Path (Join-Path $dataDir 'stop-request') | Out-Null
  Start-Sleep -Seconds 8
}
"Removed. Data kept in $dataDir."
