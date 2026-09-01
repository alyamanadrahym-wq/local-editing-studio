$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  throw "Python launcher (py.exe) was not found. Install Python 3.11 or 3.12 from https://www.python.org/downloads/windows/ and enable the Python launcher."
}

$version = & py -3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($LASTEXITCODE -ne 0) {
  throw "Could not start Python through the py launcher."
}
if ([version]$version -lt [version]"3.10") {
  throw "Python 3.10 or newer is required (found $version)."
}

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  & py -3 -m venv .venv
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the Python virtual environment." }
}
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Failed to upgrade pip." }
& .\.venv\Scripts\python.exe -m pip install --requirement requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Failed to install Python dependencies." }

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "FFmpeg/ffprobe were not found. Install FFmpeg and add its bin directory to PATH, then rerun setup.ps1."
  }
  Write-Host "Installing FFmpeg with winget..."
  & winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget could not install FFmpeg." }
  Write-Warning "FFmpeg was installed. Open a new PowerShell window so PATH is refreshed, then rerun setup.ps1."
  exit 0
}

Write-Host "Setup complete. Start the engine with: .\run.ps1"
