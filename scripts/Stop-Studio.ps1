$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path $PSScriptRoot -Parent
$processFile = Join-Path $studioRoot 'data\studio-processes.json'
if (-not (Test-Path -LiteralPath $processFile)) { Write-Host 'No app processes are registered.'; exit 0 }
$ownedProcesses = (Get-Content -LiteralPath $processFile -Raw -Encoding UTF8 | ConvertFrom-Json)
foreach ($record in $ownedProcesses) {
    $running = Get-Process -Id $record.id -ErrorAction SilentlyContinue
    if ($running) {
        $sameStart = $running.StartTime.ToUniversalTime().Ticks -eq ([datetime]$record.started).ToUniversalTime().Ticks
        $sameExecutable = $record.executable -and ($running.Path -eq $record.executable)
        if ($sameStart -and $sameExecutable) {
            # The Windows virtual-environment launcher can own a Python child.
            $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($running.Id)"
            foreach ($child in $children) {
                if ($child.CommandLine -match 'uvicorn.*app.main:app' -and $child.CommandLine -match 'apps/api') {
                    # Native speech processes belong to this verified API child.
                    # Close them as well when stopping the application's services.
                    $speechChildren = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($child.ProcessId)"
                    foreach ($speechChild in $speechChildren) {
                        if ($speechChild.ExecutablePath -eq $child.ExecutablePath -and $speechChild.CommandLine -match 'multiprocessing\.(spawn|resource_tracker)') {
                            Stop-Process -Id $speechChild.ProcessId -ErrorAction SilentlyContinue
                        }
                    }
                    Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
                }
            }
            Stop-Process -Id $running.Id -ErrorAction SilentlyContinue
            Write-Host "Stopped app process $($running.Id)."
        }
        else { Write-Warning "Skipped PID $($record.id): it no longer matches the registered app process." }
    }
}
'[]' | Set-Content -LiteralPath $processFile
Write-Host 'The ChatGPT gateway is separate and has not been stopped.'
