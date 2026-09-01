param(
  [string]$Version = "1.0.0",
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-fA-F0-9]{64}$")]
  [string]$FfmpegSha256,
  [string]$FfmpegUrl = "https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip"
)

$ErrorActionPreference = "Stop"
$EngineDir = Split-Path -Parent $PSScriptRoot
$BuildDir = Join-Path $EngineDir "build"
$DistDir = Join-Path $EngineDir "dist"
$ToolsDir = Join-Path $BuildDir "tools"
$VenvPython = Join-Path $BuildDir ".venv\Scripts\python.exe"

Remove-Item $BuildDir, $DistDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildDir, $DistDir, $ToolsDir | Out-Null

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  throw "Python 3.11 or 3.12 with the py launcher is required to build the installer."
}
& py -3 -m venv (Join-Path $BuildDir ".venv")
& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -r (Join-Path $EngineDir "requirements-runtime.txt") pyinstaller==6.11.1

$zip = Join-Path $BuildDir "ffmpeg.zip"
Invoke-WebRequest $FfmpegUrl -OutFile $zip
$actualHash = (Get-FileHash $zip -Algorithm SHA256).Hash
if ($actualHash -ne $FfmpegSha256) {
  throw "FFmpeg checksum mismatch. Expected $FfmpegSha256 but downloaded $actualHash."
}
Expand-Archive $zip -DestinationPath (Join-Path $BuildDir "ffmpeg") -Force
$ffmpeg = Get-ChildItem (Join-Path $BuildDir "ffmpeg") -Filter ffmpeg.exe -Recurse | Select-Object -First 1
$ffprobe = Get-ChildItem (Join-Path $BuildDir "ffmpeg") -Filter ffprobe.exe -Recurse | Select-Object -First 1
if (-not $ffmpeg -or -not $ffprobe) { throw "The FFmpeg archive did not contain ffmpeg.exe and ffprobe.exe." }
Copy-Item $ffmpeg.FullName, $ffprobe.FullName $ToolsDir

Push-Location $EngineDir
try {
  & $VenvPython -m PyInstaller --noconfirm --clean --onedir --console `
    --name LocalEditingEngine `
    --collect-all faster_whisper --collect-all ctranslate2 `
    --add-data "$ToolsDir;tools" engine.py
  if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed." }
} finally {
  Pop-Location
}

$frozenTools = Join-Path $DistDir "LocalEditingEngine\_internal\tools"
if (-not (Test-Path (Join-Path $frozenTools "ffmpeg.exe")) -or
    -not (Test-Path (Join-Path $frozenTools "ffprobe.exe"))) {
  throw "Frozen output is missing bundled FFmpeg tools."
}

$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if (-not $iscc) {
  $defaultIscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
  if (Test-Path $defaultIscc) { $iscc = Get-Item $defaultIscc }
}
if (-not $iscc) { throw "Install Inno Setup 6 to build the final installer." }

& $iscc.Source "/DAppVersion=$Version" (Join-Path $PSScriptRoot "installer.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed." }
Write-Host "Installer created in $DistDir"