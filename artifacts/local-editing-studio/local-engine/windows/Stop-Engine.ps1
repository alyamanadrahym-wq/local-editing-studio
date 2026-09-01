param([switch]$Silent)

$StateDir = Join-Path $env:LOCALAPPDATA "LocalEditingStudio"
$InstallDir = Split-Path -Parent $PSScriptRoot
$ExpectedExe = Join-Path $InstallDir "engine\LocalEditingEngine.exe"
$StateFile = Join-Path $StateDir "engine-state.json"
$stopped = $false
$unverified = $false

if (Test-Path $StateFile) {
  $state = Get-Content $StateFile -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  $process = if ($state.pid) { Get-Process -Id $state.pid -ErrorAction SilentlyContinue } else { $null }
  if ($process -and $process.Path -eq $ExpectedExe -and $state.executable -eq $ExpectedExe) {
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:4317/health" -TimeoutSec 2
      if ($health.instance_id -eq $state.instance_id) {
        Stop-Process -Id $state.pid
        try { Wait-Process -Id $state.pid -Timeout 10 -ErrorAction SilentlyContinue } catch {}
        $stopped = $true
      } else {
        $unverified = $true
      }
    } catch {
      $unverified = $true
    }
  }
  if (-not $unverified) { Remove-Item $StateFile -Force -ErrorAction SilentlyContinue }
}

if (-not $Silent) {
  Add-Type -AssemblyName PresentationFramework
  $message = if ($stopped) {
    "تم إيقاف محرك المونتاج."
  } elseif ($unverified) {
    "تعذر التأكد من هوية عملية المحرك، لذلك لم يتم إيقافها. أغلق LocalEditingEngine.exe من «إدارة المهام» إذا لزم."
  } else {
    "محرك المونتاج متوقف بالفعل."
  }
  $icon = if ($unverified) { "Warning" } else { "Information" }
  [System.Windows.MessageBox]::Show($message, "محرك المونتاج", "OK", $icon) | Out-Null
}

if ($unverified) { exit 2 }