$StateDir = Join-Path $env:LOCALAPPDATA "LocalEditingStudio"
$InstallDir = Split-Path -Parent $PSScriptRoot
$ExpectedExe = Join-Path $InstallDir "engine\LocalEditingEngine.exe"
$StateFile = Join-Path $StateDir "engine-state.json"
$TokenFile = Join-Path $StateDir "EngineData\pairing-token.txt"
$running = $false

if (Test-Path $StateFile) {
  $state = Get-Content $StateFile -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  $process = if ($state.pid) { Get-Process -Id $state.pid -ErrorAction SilentlyContinue } else { $null }
  $running = [bool]($process -and $process.Path -eq $ExpectedExe -and $state.executable -eq $ExpectedExe)
}

if ($running) {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:4317/health" -TimeoutSec 2
    $running = $health.status -eq "ok" -and $health.instance_id -eq $state.instance_id
  } catch { $running = $false }
}

$token = if (Test-Path $TokenFile) { (Get-Content $TokenFile -Raw).Trim() } else { "غير متاح بعد" }
if ($running -and $token -ne "غير متاح بعد") { Set-Clipboard $token }

Add-Type -AssemblyName PresentationFramework
$message = if ($running) {
  "المحرك متصل وجاهز.`n`nرمز الاقتران:`n$token`n`nتم نسخ الرمز إلى الحافظة."
} else {
  "المحرك غير متصل. شغّله من اختصار «تشغيل محرك المونتاج»."
}
[System.Windows.MessageBox]::Show($message, "حالة محرك المونتاج", "OK", $(if ($running) { "Information" } else { "Warning" })) | Out-Null