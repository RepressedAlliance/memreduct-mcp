// Memory figures from Windows itself, so results are measured, not claimed.
import { powershell } from './memreduct.js';

const SCRIPT = `
$os = Get-CimInstance Win32_OperatingSystem
$top = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 |
  ForEach-Object { [pscustomobject]@{ name = $_.ProcessName; pid = $_.Id; workingSetMB = [math]::Round($_.WorkingSet64 / 1MB) } }
[pscustomobject]@{
  totalMB = [math]::Round($os.TotalVisibleMemorySize / 1KB)
  availableMB = [math]::Round((Get-Counter '\\Memory\\Available MBytes').CounterSamples[0].CookedValue)
  commitLimitMB = [math]::Round($os.TotalVirtualMemorySize / 1KB)
  commitUsedMB = [math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1KB)
  topProcesses = @($top)
} | ConvertTo-Json -Depth 3 -Compress`;

export async function memoryStatus() {
  return JSON.parse(await powershell(SCRIPT));
}
