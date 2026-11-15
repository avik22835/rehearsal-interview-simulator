$ErrorActionPreference = 'Stop'
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:18790/health' -TimeoutSec 5
if (-not $health.extensionConnected) {
    throw 'Gateway is running but the extension is disconnected. Reload the extension and refresh ChatGPT.'
}
Write-Host 'Extension connected. Sending one short streaming test to ChatGPT...'
$testRequest = @{
    model = 'auto'
    messages = @(@{ role = 'user'; content = 'Explain a hash map in six short sentences. Use plain text without Markdown.' })
    stream = $true
    new_conversation = $true
    timeout = 180000
} | ConvertTo-Json -Depth 5 -Compress
$streamLines = New-Object 'System.Collections.Generic.List[string]'
$testRequest | curl.exe --no-buffer --silent --show-error --fail-with-body --max-time 200 `
    'http://127.0.0.1:18790/v1/chat/completions' `
    -H 'Content-Type: application/json' --data-binary '@-' | ForEach-Object {
        Write-Host $_
        $streamLines.Add([string]$_)
    }
if ($LASTEXITCODE -ne 0) {
    throw 'Streaming transport failed. Check the gateway terminal and data/gateway.log.'
}
if ($streamLines.Contains('event: error') -or -not $streamLines.Contains('data: [DONE]')) {
    throw 'The gateway did not complete the answer. See the error above and data/gateway.log.'
}
Write-Host 'Streaming test passed: answer completed with [DONE].'
