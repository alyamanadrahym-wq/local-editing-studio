Set-Location $PSScriptRoot

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  throw "Virtual environment not found. Run .\setup.ps1 first."
}
$token = & .\.venv\Scripts\python.exe -c "from main import pairing_token; print(pairing_token())"
if ($LASTEXITCODE -ne 0) { throw "Could not create or read the local pairing token." }
Write-Host ""
Write-Host "Local Editing Engine pairing token (keep this private):" -ForegroundColor Yellow
Write-Host $token -ForegroundColor Cyan
Write-Host "Clients must send it in X-Local-Engine-Token." -ForegroundColor Yellow
Write-Host ""
& .\.venv\Scripts\python.exe .\engine.py
if ($LASTEXITCODE -ne 0) {
  throw "The local editing engine stopped with exit code $LASTEXITCODE."
}
