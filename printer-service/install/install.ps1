#Requires -Version 5.1
<#
.SYNOPSIS
  Installs Sokasport PrinterBridge to C:\Sokasport\PrinterBridge and registers auto-start.

.PARAMETER ComPort
  Optional COM port (e.g. COM3). Leave empty for auto-detect.

.PARAMETER SkipStartup
  Do not add a Startup folder shortcut.
#>
param(
  [string]$ComPort = "",
  [switch]$SkipStartup
)

$ErrorActionPreference = "Stop"

$InstallDest = "C:\Sokasport\PrinterBridge"
$ApiKey = "sokasport-local-print-v1"
$HealthUrl = "http://127.0.0.1:3005/health"

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "    OK: $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host "    WARN: $Message" -ForegroundColor Yellow
}

function Stop-PrinterBridge {
  Get-Process -Name "PrinterBridge" -ErrorAction SilentlyContinue | Stop-Process -Force
}

function Get-SourceDir {
  $scriptDir = $PSScriptRoot
  if ((Split-Path -Leaf $scriptDir) -eq "install") {
    return (Split-Path $scriptDir -Parent)
  }
  return $scriptDir
}

function Copy-BridgeFiles([string]$SourceDir, [string]$Dest) {
  $items = @("PrinterBridge.exe", "node_modules", "config.json", "install")
  foreach ($item in $items) {
    $src = Join-Path $SourceDir $item
    if (-not (Test-Path $src)) {
      throw "Missing required file: $src`nRun npm run build:exe first, or copy the full dist folder."
    }
    $target = Join-Path $Dest $item
    if (Test-Path $target) {
      Remove-Item $target -Recurse -Force
    }
    Copy-Item $src $target -Recurse -Force
  }
}

function Write-Config([string]$Dest, [string]$Port) {
  $configPath = Join-Path $Dest "config.json"
  $config = @{
    comPort     = $Port
    baudRate    = 9600
    printerName = "Shop Counter"
    apiKey      = $ApiKey
  } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($configPath, $config + "`n", [System.Text.UTF8Encoding]::new($false))
}

function Write-HiddenLauncher([string]$Dest) {
  $exePath = Join-Path $Dest "PrinterBridge.exe"
  $vbsPath = Join-Path $Dest "PrinterBridge-hidden.vbs"
  $vbs = "CreateObject(""Wscript.Shell"").Run ""$exePath"", 0, False"
  [System.IO.File]::WriteAllText($vbsPath, $vbs, [System.Text.ASCIIEncoding]::new())
}

function Register-StartupShortcut([string]$Dest) {
  $startup = [Environment]::GetFolderPath("Startup")
  $vbsPath = Join-Path $Dest "PrinterBridge-hidden.vbs"
  $shortcutPath = Join-Path $startup "Sokasport PrinterBridge.lnk"

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $vbsPath
  $shortcut.WorkingDirectory = $Dest
  $shortcut.Description = "Sokasport PrinterBridge (hidden)"
  $shortcut.Save()
}

function Test-BridgeHealth {
  param([int]$Retries = 8, [int]$DelaySec = 2)
  for ($i = 1; $i -le $Retries; $i++) {
    try {
      $response = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
      if ($response.ok) {
        return $response
      }
    } catch {
      # Bridge may still be starting
    }
    Start-Sleep -Seconds $DelaySec
  }
  return $null
}

Write-Host ""
Write-Host "Sokasport PrinterBridge Installer" -ForegroundColor White
Write-Host "================================" -ForegroundColor White

$SourceDir = Get-SourceDir
Write-Step "Source: $SourceDir"
Write-Step "Destination: $InstallDest"

Write-Step "Stopping any running PrinterBridge"
Stop-PrinterBridge
Write-Ok "Ready"

Write-Step "Creating install folder"
New-Item -ItemType Directory -Force -Path $InstallDest | Out-Null
Write-Ok $InstallDest

Write-Step "Copying PrinterBridge files"
Copy-BridgeFiles -SourceDir $SourceDir -Dest $InstallDest
Write-Ok "Files copied"

Write-Step "Writing config.json"
Write-Config -Dest $InstallDest -Port $ComPort
if ($ComPort) {
  Write-Ok "COM port set to $ComPort"
} else {
  Write-Ok "COM port left empty (auto-detect on startup)"
}

Write-Step "Creating hidden launcher"
Write-HiddenLauncher -Dest $InstallDest
Write-Ok "PrinterBridge-hidden.vbs"

if (-not $SkipStartup) {
  Write-Step "Registering auto-start on login"
  Register-StartupShortcut -Dest $InstallDest
  Write-Ok "Startup shortcut created"
} else {
  Write-Warn "Skipped Startup shortcut (-SkipStartup)"
}

Write-Step "Starting PrinterBridge"
$exePath = Join-Path $InstallDest "PrinterBridge.exe"
Start-Process -FilePath $exePath -WorkingDirectory $InstallDest
Write-Ok "Process started"

Write-Step "Verifying service"
$health = Test-BridgeHealth
if ($health) {
  Write-Ok "Health check passed (uptime $($health.uptimeSec)s)"
  if (-not $health.connected) {
    Write-Warn "Printer not connected yet - install POS80 driver and plug in the printer"
  }
} else {
  Write-Warn "Health check timed out - check Task Manager for PrinterBridge.exe"
}

Write-Host ""
Write-Host "Installation complete." -ForegroundColor Green
Write-Host "Open https://admin.sokasport.com and check the Printer bar on the Tickets page."
Write-Host ""
Write-Host "Prerequisite: POS80 driver installed and printer connected via USB."
Write-Host ""
