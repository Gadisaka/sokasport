# Sokasport PrinterBridge — Cashier Install Guide

Install only two things on each cashier PC:

1. **POS80Setup_20200118.exe** — official thermal printer driver
2. **PrinterBridge** — local print bridge (no Node.js required)

After setup, open **https://admin.sokasport.com** and tickets print silently. No WebUSB, Zadig, browser print dialog, or terminal.

---

## Quick install (automated)

1. Install **POS80Setup_20200118.exe** and connect the printer via USB
2. Copy the entire **`dist/`** folder to the cashier PC (USB stick, zip, etc.)
3. Double-click **`Install-PrinterBridge.bat`** in that folder

The installer will:

- Copy files to `C:\Sokasport\PrinterBridge\`
- Write `config.json` with COM port **auto-detect** (empty `comPort`)
- Add a hidden auto-start shortcut on Windows login
- Start PrinterBridge and run a health check

**Optional:** set a fixed COM port from PowerShell:

```powershell
cd install
powershell -ExecutionPolicy Bypass -File install.ps1 -ComPort COM3
```

---

## Manual install

Use this if you prefer to configure everything by hand.

### Step 1: Install POS80 driver

1. Run `POS80Setup_20200118.exe`
2. Connect the thermal printer via USB
3. Open **Device Manager** → **Ports (COM & LPT)**
4. Note the COM port (e.g. `COM3`)

---

## Step 2: Install PrinterBridge (manual)

1. Create folder: `C:\Sokasport\PrinterBridge\`
2. Copy the **entire contents** of the build `dist/` folder into that directory:
   - `PrinterBridge.exe`
   - `node_modules/` (required — native serialport drivers)
   - `config.json`
   - `install/` (optional)
3. Edit `config.json`:

```json
{
  "comPort": "COM3",
  "baudRate": 9600,
  "printerName": "Shop Counter",
  "apiKey": "sokasport-local-print-v1"
```

Replace `COM3` with your port from Device Manager.

---

## Step 3: Auto-start on login (manual)

### Option A — Hidden startup (no window)

1. Copy `PrinterBridge-hidden.vbs` to `C:\Sokasport\PrinterBridge\`
2. Press `Win + R`, type `shell:startup`, press Enter
3. Create a shortcut to `PrinterBridge-hidden.vbs` in the Startup folder

### Option B — Minimized window

1. Press `Win + R`, type `shell:startup`, press Enter
2. Create a shortcut to `C:\Sokasport\PrinterBridge\PrinterBridge.exe`
3. Right-click shortcut → **Properties** → **Run: Minimized**

---

## Step 4: Verify

1. Log in to Windows (PrinterBridge starts automatically)
2. Open **https://admin.sokasport.com** in Chrome or Edge
3. Printer bar should show **Printer Connected (COM3)** or **Printer Offline** if unplugged
4. Sell and print a test ticket

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Printer Offline | Check USB cable; confirm COM port in `config.json` |
| Local print service unreachable | Ensure `PrinterBridge.exe` is running (Task Manager) |
| Auth failed | `apiKey` in `config.json` must match cashier app build |
| Wrong COM port | Run `GET http://localhost:3005/printers` with auth header, or check Device Manager |
| Printing is very slow (seconds–minutes) | When the native printer driver isn't available, the bridge prints via a helper `powershell.exe` process. Antivirus / Windows Defender real-time scanning of PowerShell (AMSI) can add large delays. Add an exclusion (see below). |

### Antivirus exclusions (fixes slow printing)

If prints take several seconds or more, exclude the bridge and its helper from
real-time scanning. In an **elevated** PowerShell:

```powershell
Add-MpPreference -ExclusionPath "C:\Sokasport\PrinterBridge"
Add-MpPreference -ExclusionProcess "PrinterBridge.exe"
Add-MpPreference -ExclusionProcess "powershell.exe"
```

The bridge already keeps a single long-lived `powershell.exe` worker (it no
longer launches a new PowerShell per ticket), so these exclusions plus the
worker keep printing near-instant.

---

## Security notes

- PrinterBridge listens on **127.0.0.1:3005 only** — not accessible from other PCs on the network
- API key header `X-Printer-Key` is required for print/status requests
- Default key: `sokasport-local-print-v1` (change only if you rebuild the cashier app with matching `VITE_PRINTER_API_KEY`)

---

## For IT / developers

Build the exe from source:

```bash
cd printer-service
npm install
npm run build:exe
```

Output: `dist/PrinterBridge.exe` + `dist/config.json` + `dist/install/`

Cashier admin app env (production build):

```
VITE_PRINT_SERVICE_URL=http://localhost:3005
VITE_PRINTER_API_KEY=sokasport-local-print-v1
```
