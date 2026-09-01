$ErrorActionPreference = "Stop"

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
  throw "FFmpeg download failed with curl exit code $LASTEXITCODE."
}
if (-not (Test-Path $archive)) {
  throw "FFmpeg download did not create $archive."
}

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
if (-not $ffmpeg -or -not $ffprobe) {
  throw "The pinned FFmpeg archive did not contain ffmpeg.exe and ffprobe.exe."
}

$bin = $ffmpeg.DirectoryName
$env:Path = "$bin;$env:Path"
Add-Content -Path $env:GITHUB_PATH -Value $bin

& $ffmpeg.FullName -version | Select-Object -First 1
& $ffprobe.FullName -version | Select-Object -First 1