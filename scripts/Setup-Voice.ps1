param([string]$RuntimeSource = '')
$ErrorActionPreference = 'Stop'
$voiceProjectRoot = Split-Path $PSScriptRoot -Parent
$voicePython = Join-Path $voiceProjectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $voicePython)) { throw 'Create the project Python environment first.' }
$env:PYTHONIOENCODING = 'utf-8'
& $voicePython -m pip install --progress-bar off -r (Join-Path $voiceProjectRoot 'apps/api/requirements-voice.txt')
if ($LASTEXITCODE -ne 0) { throw 'Speech package installation failed.' }
if ($RuntimeSource) {
    # Optional app-local runtime; does not replace Windows system DLLs.
    $voiceRuntimeNames = @('vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll')
    foreach ($voiceRuntimeName in $voiceRuntimeNames) {
        $voiceRuntimeSignature = Get-AuthenticodeSignature -LiteralPath (Join-Path $RuntimeSource $voiceRuntimeName)
        if ($voiceRuntimeSignature.Status -ne 'Valid' -or $voiceRuntimeSignature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') { throw "Unverified Microsoft runtime: $voiceRuntimeName" }
    }
    $voiceModelRoot = if ($env:REHEARSAL_VOICE_DIR) { $env:REHEARSAL_VOICE_DIR } else { Join-Path $env:LOCALAPPDATA 'Rehearsal/voice' }
    $voiceRuntimeTarget = Join-Path $voiceModelRoot 'runtime'
    New-Item -ItemType Directory -Force -Path $voiceRuntimeTarget | Out-Null
    foreach ($voiceRuntimeName in $voiceRuntimeNames) { Copy-Item -LiteralPath (Join-Path $RuntimeSource $voiceRuntimeName) -Destination (Join-Path $voiceRuntimeTarget $voiceRuntimeName) -Force }
}
& $voicePython (Join-Path $PSScriptRoot 'setup-voice.py')
if ($LASTEXITCODE -ne 0) { throw 'Speech model setup failed. Rerun this script to retry.' }
Write-Host 'Local speech models are ready. Restart the app backend if it was already running.'
