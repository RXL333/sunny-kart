param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required. Install the official Node.js LTS and try again.' }
$running = $false
try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 2; $running = $health.service -eq 'sunny-kart' } catch { }
if (-not $running) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist/index.html'))) { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed.' } }
    $logFolder = Join-Path $PSScriptRoot 'logs'
    New-Item -ItemType Directory -Path $logFolder -Force | Out-Null
    $serverProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server/index.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logFolder 'server.log') -RedirectStandardError (Join-Path $logFolder 'server-error.log') -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 1; if ($health.service -eq 'sunny-kart') { $running = $true; break } } catch { }
        if ($serverProcess.HasExited) { throw 'Server stopped. Check logs/server-error.log. Port 3001 may already be in use.' }
    }
    if (-not $running) { throw 'Server did not start. Check logs/server-error.log.' }
    $serverProcess.Id | Set-Content -LiteralPath (Join-Path $logFolder 'server.pid')
}
if (-not $NoBrowser) { Start-Process 'http://localhost:3001' }
Write-Host 'Sunny Kart is ready: http://localhost:3001'
