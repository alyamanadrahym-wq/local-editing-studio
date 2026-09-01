$ErrorActionPreference = "Stop"
$InstallDir = Split-Path -Parent $PSScriptRoot
$Exe = Join-Path $InstallDir "engine\LocalEditingEngine.exe"
$StateDir = Join-Path $env:LOCALAPPDATA "LocalEditingStudio"
$DataDir = Join-Path $StateDir "EngineData"
$StateFile = Join-Path $StateDir "engine-state.json"
$LogFile = Join-Path $StateDir "engine.log"

New-Item -ItemType Directory -Force -Path $StateDir, $DataDir | Out-Null

if (Test-Path $StateFile) {
  $oldState = Get-Content $StateFile -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  $oldProcess = if ($oldState.pid) { Get-Process -Id $oldState.pid -ErrorAction SilentlyContinue } else { $null }
  if ($oldProcess -and $oldProcess.Path -eq $Exe) {
    try {
      $oldHealth = Invoke-RestMethod "http://127.0.0.1:4317/health" -TimeoutSec 2
      if ($oldHealth.instance_id -eq $oldState.instance_id) {
        & (Join-Path $PSScriptRoot "Show-Status.ps1")
        exit 0
      }
    } catch {}
  }
  Remove-Item $StateFile -Force -ErrorAction SilentlyContinue
}

$instanceId = [guid]::NewGuid().ToString("N")
$env:LOCAL_EDITING_ENGINE_DATA = $DataDir
$env:LOCAL_EDITING_ENGINE_INSTANCE = $instanceId
$process = Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe) `
  -RedirectStandardOutput $LogFile -RedirectStandardError (Join-Path $StateDir "engine-error.log") `
  -WindowStyle Hidden -PassThru
@{ pid = $process.Id; executable = $Exe; instance_id = $instanceId } |
  ConvertTo-Json | Set-Content -Path $StateFile -Encoding utf8

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500
  $process.Refresh()
  if ($process.HasExited) { break }
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:4317/health" -TimeoutSec 2
    if ($health.status -eq "ok" -and $health.instance_id -eq $instanceId) {
      $process.Refresh()
      if (-not $process.HasExited) { $ready = $true; break }
    }
  } catch {}
}

if (-not $ready) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
  Remove-Item $StateFile -Force -ErrorAction SilentlyContinue
  $details = if (Test-Path $LogFile) { Get-Content $LogFile -Tail 20 | Out-String } else { "" }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("تعذر تشغيل محرك المونتاج.`n$details", "محرك المونتاج", "OK", "Error") | Out-Null
  exit 1
}

& (Join-Path $PSScriptRoot "Show-Status.ps1")