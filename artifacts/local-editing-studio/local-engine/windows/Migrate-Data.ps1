param([Parameter(Mandatory = $true)][string]$InstallDir)

$ErrorActionPreference = "Stop"
$newData = Join-Path $env:LOCALAPPDATA "LocalEditingStudio\EngineData"
$oldRoots = @(
  (Join-Path $InstallDir "engine\data"),
  (Join-Path $InstallDir "engine\_internal\data"),
  (Join-Path $InstallDir "data")
)

$stopScript = Join-Path $InstallDir "commands\Stop-Engine.ps1"
if (Test-Path $stopScript) {
  & $stopScript -Silent
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

New-Item -ItemType Directory -Force -Path $newData | Out-Null
foreach ($oldData in $oldRoots) {
  if (-not (Test-Path $oldData) -or
      [System.IO.Path]::GetFullPath($oldData) -eq [System.IO.Path]::GetFullPath($newData)) {
    continue
  }
  & robocopy $oldData $newData /E /MOVE /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS
  if ($LASTEXITCODE -ge 8) {
    Write-Error "Could not safely migrate local projects from $oldData (robocopy exit $LASTEXITCODE)."
    exit $LASTEXITCODE
  }
  if (Test-Path $oldData) { Remove-Item $oldData -Recurse -Force -ErrorAction SilentlyContinue }
}
exit 0