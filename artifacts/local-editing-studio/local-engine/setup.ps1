Write-Warning "setup.ps1 is retained for developers only. End users should install dist\LocalEditingEngine-Setup-<version>.exe."
& (Join-Path $PSScriptRoot "windows\build-installer.ps1") @args
