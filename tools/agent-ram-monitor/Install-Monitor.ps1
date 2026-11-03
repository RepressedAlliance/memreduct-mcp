# Installs the agent RAM monitor for the current user, without administrator rights:
# a scheduled task that starts monitor.ps1 at logon and, every 5 minutes, starts it again
# if it is not running (the monitor allows only one copy of itself). Then starts it now.
# Remove with Uninstall-Monitor.ps1; recorded data stays in %USERPROFILE%\.memreduct-mcp\monitor.
param(
  [string]$OtherToolStateFile = '',
  [string]$OtherToolName = 'other tool'
)
$ErrorActionPreference = 'Stop'
$taskName = 'memreduct-agent-ram-monitor'
$script = Join-Path $PSScriptRoot 'monitor.ps1'
# Windows PowerShell 5.1 ships with Windows and never moves; a Store-installed pwsh can.
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

$argsLine = "--headless `"$powershell`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`""
if ($OtherToolStateFile) { $argsLine += " -OtherToolStateFile `"$OtherToolStateFile`" -OtherToolName `"$OtherToolName`"" }
# conhost --headless runs the console host without a window, so nothing flashes on screen.
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" -Argument $argsLine -WorkingDirectory $PSScriptRoot

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -DontStopOnIdleEnd `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $atLogon, $watchdog -Settings $settings -Principal $principal `
  -Description 'memreduct-mcp: records AI agent memory use and Mem Reduct cleans (memory figures only). See tools/agent-ram-monitor/README.md.' -Force | Out-Null
# Hand over to the task: stop a copy started some other way, so the running monitor is the
# one the task watches (and runs outside any app's package).
$dataDir = Join-Path $env:USERPROFILE '.memreduct-mcp\monitor'
$hb = Join-Path $dataDir 'heartbeat.json'
if (Test-Path -LiteralPath $hb) {
  $old = (Get-Content -LiteralPath $hb -Raw | ConvertFrom-Json).pid
  if (Get-Process -Id $old -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in 'powershell', 'pwsh' }) {
    New-Item -ItemType File -Force -Path (Join-Path $dataDir 'stop-request') | Out-Null
    Start-Sleep -Seconds 8
    Get-Process -Id $old -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in 'powershell', 'pwsh' } | Stop-Process -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $dataDir 'stop-request') -ErrorAction SilentlyContinue
  }
}
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 5
& (Join-Path $PSScriptRoot 'status.ps1')
