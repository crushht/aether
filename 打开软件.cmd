@echo off
rem Double-click entry for the packaged desktop app.
rem Falls back to the dev shell (start.ps1 -Desktop) when no build exists.
setlocal
cd /d "%~dp0"

set "APP=%~dp0dist\win-unpacked\Aether.exe"
if exist "%APP%" (
  start "" "%APP%"
  exit /b 0
)

echo Packaged app not found in dist\win-unpacked - starting the dev shell instead.
echo (run "npm run dist" once to produce the packaged app)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Desktop
exit /b %ERRORLEVEL%
