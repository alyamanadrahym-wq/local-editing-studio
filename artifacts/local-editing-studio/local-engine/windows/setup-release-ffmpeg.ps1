$ErrorActionPreference = "Stop"
trap {
  $message = $_.Exception.Message.Replace("%", "%25").Replace("`r", "%0D").Replace("`n", "%0A")
  Write-Host "::error title=FFmpeg setup failed::$message"
  exit 1
}

$version = "7.1.1"
$url = "https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip"
$expectedSha256 = "04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4"
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$root = Join-Path $tempRoot "local-editing-studio-ffmpeg-$version"
$archive = Join-Path $tempRoot "ffmpeg-$version.zip"

Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $archive -Force -ErrorAction SilentlyContinue
Write-Host "Downloading pinned FFmpeg $version..."
& curl.exe --fail --location --retry 3 --retry-delay 2 --user-agent "local-editing-studio-release-smoke" --output $archive $url
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Direct FFmpeg archive download failed with curl exit code $LASTEXITCODE; trying the pinned Chocolatey package."
}

$ffmpeg = $null
$ffprobe = $null
if (Test-Path $archive) {
  $actualSha256 = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "FFmpeg checksum mismatch. Expected $expectedSha256 but downloaded $actualSha256."
  }

  $null = New-Item -ItemType Directory -Path $root -Force
  Write-Host "Extracting pinned FFmpeg..."
  & tar.exe -xf $archive -C $root
  if ($LASTEXITCODE -ne 0) {
    throw "FFmpeg archive extraction failed with tar exit code $LASTEXITCODE."
  }
  $ffmpeg = Get-ChildItem $root -Filter ffmpeg.exe -Recurse | Select-Object -First 1
  $ffprobe = Get-ChildItem $root -Filter ffprobe.exe -Recurse | Select-Object -First 1
}

if (-not $ffmpeg -or -not $ffprobe) {
  if (-not (Get-Command choco.exe -ErrorAction SilentlyContinue)) {
    throw "The pinned FFmpeg archive could not be downloaded and Chocolatey is unavailable."
  }
  Write-Host "Installing pinned Chocolatey FFmpeg $version fallback..."
  & choco.exe install ffmpeg --version $version --no-progress --yes --force
  if ($LASTEXITCODE -ne 0) {
    throw "Pinned Chocolatey FFmpeg installation failed with exit code $LASTEXITCODE."
  }
  $chocoRoot = if ($env:ChocolateyInstall) {
    Join-Path $env:ChocolateyInstall "lib"
  } else {
    "C:\ProgramData\chocolatey\lib"
  }
  $ffmpeg = Get-ChildItem $chocoRoot -Filter ffmpeg.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "ffmpeg\.7\.1\.1" } | Select-Object -First 1
  $ffprobe = Get-ChildItem $chocoRoot -Filter ffprobe.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "ffmpeg\.7\.1\.1" } | Select-Object -First 1
  if (-not $ffmpeg -or -not $ffprobe) {
    throw "Pinned Chocolatey FFmpeg $version did not provide ffmpeg.exe and ffprobe.exe."
  }
}

$bin = $ffmpeg.DirectoryName
$env:Path = "$bin;$env:Path"
Add-Content -Path $env:GITHUB_PATH -Value $bin

& $ffmpeg.FullName -version | Select-Object -First 1
if ($LASTEXITCODE -ne 0) {
  throw "Pinned FFmpeg could not start."
}
if ((& $ffmpeg.FullName -version | Select-Object -First 1) -notmatch "ffmpeg version 7\.1\.1") {
  throw "The selected FFmpeg is not version $version."
}
& $ffprobe.FullName -version | Select-Object -First 1