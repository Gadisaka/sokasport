@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0install\install.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\install.ps1" %*
) else if exist "%~dp0install.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
) else (
  echo Could not find install.ps1
  pause
  exit /b 1
)

if errorlevel 1 (
  echo.
  echo Installation failed. See errors above.
  pause
  exit /b 1
)

echo.
pause
