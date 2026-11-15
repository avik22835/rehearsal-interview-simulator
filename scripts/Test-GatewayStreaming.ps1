$ErrorActionPreference = 'Stop'
$gatewayHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:18790/health' -TimeoutSec 5
if (-not $gatewayHealth.extensionConnected) { throw 'Reload the gateway extension, refresh ChatGPT, and retry.' }
if ([version]$gatewayHealth.extensionInfo.version -lt [version]'1.0.6') { throw 'Reload extension version 1.0.6, then refresh the ChatGPT tab.' }
Write-Host 'Testing incremental streaming. Switch to the ChatGPT tab now and keep it in the foreground until the answer finishes.'
$streamRequest = @{
    model = 'auto'
    messages = @(@{ role = 'user'; content = 'Teach hash maps in 40 short sentences, one sentence per line. Cover hashing, collisions, resizing, complexity, and practical examples. Plain text without headings or numbering. Do not repeat this request.' })
    stream = $true
    new_conversation = $true
    timeout = 120000
} | ConvertTo-Json -Depth 5 -Compress
$updateCount = 0
$characterCount = 0
$completed = $false
$failed = $false
$replacementCount = 0
$eventName = ''
$trace = New-Object 'System.Collections.Generic.List[object]'
$streamRequest | curl.exe --no-buffer --silent --show-error --fail-with-body --max-time 135 `
    'http://127.0.0.1:18790/v1/chat/completions' -H 'Content-Type: application/json' --data-binary '@-' | ForEach-Object {
    $streamLine = [string]$_
    if ($streamLine.StartsWith('event: ')) { $eventName = $streamLine.Substring(7) }
    if ($streamLine -eq 'event: error') { $failed = $true }
    if ($streamLine -eq 'data: [DONE]') { $completed = $true; Write-Host 'DONE received.' }
    elseif ($streamLine.StartsWith('data: {')) {
        $streamPart = $streamLine.Substring(6) | ConvertFrom-Json
        if ($eventName -eq 'error') { Write-Host $streamPart.error.message }
        elseif ($eventName -eq 'snapshot') {
            $replacementCount++
            $characterCount = $streamPart.content.Length
            Write-Host ('Answer revised: {0} characters total.' -f $characterCount)
        } else {
            $piece = $streamPart.choices[0].delta.content
            if ($piece) {
                $updateCount++
                $characterCount += $piece.Length
                $arrival = Get-Date -Format 'HH:mm:ss.fff'
                Write-Host ('Update {0} at {1}: +{2} characters ({3} total)' -f $updateCount,$arrival,$piece.Length,$characterCount)
                $trace.Add(@{ time = $arrival; addedCharacters = $piece.Length; totalCharacters = $characterCount })
            }
        }
    }
    if ($streamLine -eq '') { $eventName = '' }
}
$transportCode = $LASTEXITCODE
$result = @{
    extension = $gatewayHealth.extensionInfo.version
    completed = $completed
    failed = ($failed -or $transportCode -ne 0)
    contentUpdates = $updateCount
    replacementEvents = $replacementCount
    characters = $characterCount
    incrementalObserved = ($completed -and -not $failed -and $transportCode -eq 0 -and $updateCount -gt 1)
    trace = @($trace.ToArray())
}
$resultFolder = Join-Path (Split-Path $PSScriptRoot -Parent) 'data'
New-Item -ItemType Directory -Force -Path $resultFolder | Out-Null
$resultFile = Join-Path $resultFolder 'gateway-streaming-check.json'
$result | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 -LiteralPath $resultFile
Write-Host "Result saved to $resultFile"
if ($result.failed -or -not $completed) { throw 'The request failed or did not complete. Inspect gateway.log.' }
if ($updateCount -le 1) { Write-Host 'ANSWER DELIVERY PASSED. INCREMENTAL STREAMING NOT OBSERVED: the answer arrived in one content update.' }
else { Write-Host "INCREMENTAL STREAMING OBSERVED: $updateCount content updates followed by DONE." }
