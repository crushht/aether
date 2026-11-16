@echo off
rem Double-click entry: hands every argument to start.ps1 with the execution
rem policy bypassed for this one process, then keeps the window open on failure.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo start.ps1 exited with code %EXITCODE%.
  pause
)
endlocal & exit /b %EXITCODE%
