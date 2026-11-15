$ErrorActionPreference = 'Stop'
$gatewayRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'vendor\chatgpt-gateway'
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (Test-Path -LiteralPath $bundledNode) {
    $gatewayNode = $bundledNode
} else {
    $gatewayNode = (Get-Command node -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath (Join-Path $gatewayRoot 'node_modules\ws'))) {
    throw 'Install gateway dependencies first: cd vendor/chatgpt-gateway; pnpm install --frozen-lockfile --ignore-scripts'
}
Push-Location -LiteralPath $gatewayRoot
try {
    $gatewayLogFolder = Join-Path (Split-Path $PSScriptRoot -Parent) 'data'
    New-Item -ItemType Directory -Force -Path $gatewayLogFolder | Out-Null
    $gatewayLogFile = Join-Path $gatewayLogFolder 'gateway.log'
    Write-Host "Gateway connection log: $gatewayLogFile"
    & $gatewayNode 'server.mjs' 2>&1 | Tee-Object -FilePath $gatewayLogFile -Append
    if ($LASTEXITCODE -ne 0) { throw "Gateway exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
}
