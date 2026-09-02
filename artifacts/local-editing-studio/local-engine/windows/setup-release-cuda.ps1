$ErrorActionPreference = "Stop"

$engineDir = Split-Path -Parent $PSScriptRoot
$requirements = Join-Path $engineDir "requirements-cuda.txt"

Write-Host "Installing pinned CUDA 12 runtime libraries for CTranslate2..."
& python -m pip install -r $requirements
if ($LASTEXITCODE -ne 0) {
  throw "Pinned CUDA runtime installation failed with exit code $LASTEXITCODE."
}

$sitePackages = & python -c "import site; print(site.getsitepackages()[0])"
if ($LASTEXITCODE -ne 0 -or -not $sitePackages) {
  throw "Could not locate the Python site-packages directory."
}

$cudaDllDirectories = @(
  (Join-Path $sitePackages "nvidia\cublas\bin"),
  (Join-Path $sitePackages "nvidia\cudnn\bin")
)

foreach ($directory in $cudaDllDirectories) {
  if (-not (Test-Path $directory)) {
    throw "Pinned CUDA runtime directory was not installed: $directory"
  }
  $env:Path = "$directory;$env:Path"
  if ($env:GITHUB_PATH) {
    Add-Content -Path $env:GITHUB_PATH -Value $directory
  }
}

$requiredDlls = @(
  (Join-Path $cudaDllDirectories[0] "cublas64_12.dll"),
  (Join-Path $cudaDllDirectories[1] "cudnn64_9.dll")
)
foreach ($dll in $requiredDlls) {
  if (-not (Test-Path $dll)) {
    throw "Required CTranslate2 CUDA library was not installed: $dll"
  }
}

Write-Host "Pinned cuBLAS and cuDNN libraries are available to the RTX test process."