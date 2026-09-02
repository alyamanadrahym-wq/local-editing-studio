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
$pythonPrefix = & python -c "import sys; print(sys.prefix)"
if ($LASTEXITCODE -ne 0 -or -not $pythonPrefix) {
  throw "Could not locate the Python installation directory."
}

$nvidiaRoots = @(
  (Join-Path $pythonPrefix "nvidia"),
  (Join-Path $sitePackages "nvidia")
) | Where-Object { Test-Path $_ } | Select-Object -Unique
if (-not $nvidiaRoots) {
  throw "Pinned NVIDIA runtime packages were not installed under $pythonPrefix or $sitePackages."
}

$requiredDllNames = @("cublas64_12.dll", "cudnn64_9.dll")
$requiredDlls = @()
foreach ($dllName in $requiredDllNames) {
  $dll = $nvidiaRoots |
    ForEach-Object {
      Get-ChildItem $_ -Filter $dllName -Recurse -File -ErrorAction SilentlyContinue
    } |
    Select-Object -First 1
  if (-not $dll) {
    throw "Required CTranslate2 CUDA library was not installed: $dllName"
  }
  $requiredDlls += $dll
}

foreach ($root in $nvidiaRoots) {
  Get-ChildItem $root -Filter *.dll -Recurse -File -ErrorAction SilentlyContinue |
    Unblock-File -ErrorAction SilentlyContinue
}

$cudaDllDirectories = $requiredDlls |
  ForEach-Object { $_.DirectoryName } |
  Select-Object -Unique
foreach ($directory in $cudaDllDirectories) {
  $env:Path = "$directory;$env:Path"
  if ($env:GITHUB_PATH) {
    Add-Content -Path $env:GITHUB_PATH -Value $directory
  }
}

Write-Host "Pinned cuBLAS and cuDNN libraries are available to the RTX test process."