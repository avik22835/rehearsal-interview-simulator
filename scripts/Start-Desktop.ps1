$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'Start-Studio.ps1')
$desktopExe = Join-Path $desktopRoot 'apps\desktop\node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $desktopExe)) { throw 'Desktop dependencies missing. See docs/DESKTOP-CHECKPOINT.md.' }
$desktopApp = Join-Path $desktopRoot 'apps\desktop'
$desktopNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $desktopNode)) { $desktopNode = (Get-Command node -ErrorAction Stop).Source }
& $desktopNode (Join-Path $desktopApp 'build-preload.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Could not build the desktop browser adapter.' }
# This is the interactive desktop app the user needs to see for sign-in.
# Backend helpers remain hidden in Start-Studio.ps1.
Start-Process -FilePath $desktopExe -ArgumentList ('"' + $desktopApp + '"') -WorkingDirectory $desktopRoot -WindowStyle Normal | Out-Null
$desktopReady = $false
for ($desktopAttempt = 0; $desktopAttempt -lt 40; $desktopAttempt++) {
    try {
        $desktopHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:18791/health' -TimeoutSec 1
        if ($desktopHealth.extensionConnected -and $desktopHealth.extensionInfo.version -like 'desktop-*') { $desktopReady = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 250
}
if (-not $desktopReady) { throw 'The desktop gateway did not become ready. See data/desktop-host-events.jsonl.' }
Write-Host 'Desktop host opened. Its ChatGPT session is separate from Edge.'
Write-Host 'Desktop gateway: http://127.0.0.1:18791/v1. Choose that endpoint in provider settings to use the hosted view.'
