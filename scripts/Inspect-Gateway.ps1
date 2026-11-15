$ErrorActionPreference = 'Stop'
Write-Host 'Reading gateway and browser diagnostics. No prompt will be sent.'
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:18790/health' -TimeoutSec 5
Write-Host 'Gateway health:'
$health | ConvertTo-Json -Depth 8
Write-Host 'Browser diagnostics:'
$details = Invoke-RestMethod -Uri 'http://127.0.0.1:18790/diagnostics' -TimeoutSec 15
$details | ConvertTo-Json -Depth 10
