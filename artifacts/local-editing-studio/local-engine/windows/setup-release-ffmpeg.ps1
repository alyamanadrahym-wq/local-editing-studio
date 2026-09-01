$ErrorActionPreference = "Stop"

$version = "7.1.1"
$url = "https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip"
$expectedSha256 = "04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4"
$root = Join-Path $env:RUNNER_TEMP "local-editing-studio-ffmpeg-$version"
$archive = Join-Path $env:RUNNER_TEMP "ffmpeg-$version.zip"

Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
Invoke-WebRequest -Uri $url -OutFile $archive

$actualSha256 = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
  throw "FFmpeg checksum mismatch. Expected $expectedSha256 but downloaded $actualSha256."
}

Expand-Archive -Path $archive -DestinationPath $root -Force
$ffmpeg = Get-ChildItem $root -Filter ffmpeg.exe -Recurse | Select-Object -First 1
$ffprobe = Get-ChildItem $root -Filter ffprobe.exe -Recurse | Select-Object -First 1
if (-not $ffmpeg -or -not $ffprobe) {
  throw "The pinned FFmpeg archive did not contain ffmpeg.exe and ffprobe.exe."
}

$bin = $ffmpeg.Directory.FullName
$env:Path = "$bin;$env:Path"
Add-Content -Path $env:GITHUB_PATH -Value $bin

& $ffmpeg.FullName -version | Select-Object -First 1
& $ffprobe.FullName -version | Select-Object -First 1