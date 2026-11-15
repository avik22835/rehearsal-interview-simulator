param([switch]$Dev)
$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path $PSScriptRoot -Parent
$studioData = Join-Path $studioRoot 'data'
New-Item -ItemType Directory -Force -Path $studioData | Out-Null
$studioPython = Join-Path $studioRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $studioPython)) { throw 'Python environment missing. Follow docs/PHASE-1.md setup instructions.' }
$studioNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $studioNode)) { $studioNode = (Get-Command node -ErrorAction Stop).Source }
$processFile = Join-Path $studioData 'studio-processes.json'
$ownedProcesses = @()
if (Test-Path -LiteralPath $processFile) { $ownedProcesses = @((Get-Content -LiteralPath $processFile -Raw -Encoding UTF8 | ConvertFrom-Json) | ForEach-Object { $_ }) }

function Test-StudioService($serviceUrl) {
    try { $result = Invoke-RestMethod -Uri $serviceUrl -TimeoutSec 2; return ($result.status -eq 'ok' -and $result.version -eq '0.1.0') } catch { return $false }
}
function Wait-StudioService($serviceUrl) {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-StudioService $serviceUrl) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Service did not become ready at $serviceUrl. Check logs in $studioData."
}
function Save-StudioProcess($serviceProcess, $executablePath) {
    $record = @{ id = $serviceProcess.Id; started = $serviceProcess.StartTime.ToUniversalTime().ToString('o'); executable = $executablePath }
    return $record
}

if (-not (Test-StudioService 'http://127.0.0.1:8000/api/health')) {
    $apiProcess = Start-Process -FilePath $studioPython -ArgumentList '-m','uvicorn','app.main:app','--app-dir','apps/api','--host','127.0.0.1','--port','8000' -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $studioData 'api-out.log') -RedirectStandardError (Join-Path $studioData 'api-error.log') -PassThru
    $ownedProcesses += Save-StudioProcess $apiProcess $studioPython
    ConvertTo-Json -InputObject @($ownedProcesses) | Set-Content -Encoding utf8 -LiteralPath $processFile
    Wait-StudioService 'http://127.0.0.1:8000/api/health'
}
if (-not (Test-StudioService 'http://127.0.0.1:3000/api/health')) {
    $webRoot = Join-Path $studioRoot 'apps\web'
    if (-not (Test-Path -LiteralPath (Join-Path $webRoot 'public\monaco\vs\loader.js'))) {
        & $studioNode (Join-Path $webRoot 'scripts\prepare-monaco.cjs')
        if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the local coding editor assets.' }
    }
    $webMode = if ($Dev) { 'dev' } elseif (Test-Path -LiteralPath (Join-Path $webRoot '.next\BUILD_ID')) { 'start' } else { 'dev' }
    $webProcess = Start-Process -FilePath $studioNode -ArgumentList 'node_modules/next/dist/bin/next',$webMode,'--hostname','127.0.0.1','--port','3000' -WorkingDirectory $webRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $studioData 'web-out.log') -RedirectStandardError (Join-Path $studioData 'web-error.log') -PassThru
    $ownedProcesses += Save-StudioProcess $webProcess $studioNode
    ConvertTo-Json -InputObject @($ownedProcesses) | Set-Content -Encoding utf8 -LiteralPath $processFile
    Wait-StudioService 'http://127.0.0.1:3000/api/health'
}
Write-Host ''
Write-Host 'Rehearsal is ready: http://127.0.0.1:3000'
Write-Host 'Practice demo works offline. Keep your gateway running only when using ChatGPT.'
Write-Host 'Stop the app with: powershell -ExecutionPolicy Bypass -File .\scripts\Stop-Studio.ps1'
