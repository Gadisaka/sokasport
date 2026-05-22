@echo off
setlocal
cd /d "%~dp0"

echo.
echo Sokasport PrinterBridge Installer
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 (
  echo.
  echo Installation failed. See errors above.
  pause
  exit /b 1
)

echo.
pause
