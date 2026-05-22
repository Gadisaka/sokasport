# Sokasport Printer Service / PrinterBridge

Local Node print bridge for cashier thermal receipts. Receives pre-encoded ESC/POS bytes from the admin cashier UI and writes them sequentially to a POS80 printer via the official Windows driver (COM port).

**Production deployment:** cashiers install via **`Install-PrinterBridge.bat`** in the build `dist/` folder — see [install/INSTALL.md](install/INSTALL.md).

## Prerequisites

1. Install POS80 driver: `POS80Setup_20200118.exe`
2. Connect the thermal printer via USB
3. Note the assigned COM port in Windows Device Manager (e.g. `COM3`)

## Developer setup

```bash
cd printer-service
npm install
npm start
```

## Build Windows exe

```bash
npm run build:exe
```

Produces:

- `dist/PrinterBridge.exe` — self-contained, no Node required on cashier PC
- `dist/config.json` — copy beside exe on install
- `dist/Install-PrinterBridge.bat` — one-click cashier installer
- `dist/install/` — VBS launcher, PowerShell installer, install guide

Requires Windows build host with Node.js installed (build machine only).

## Configuration

Settings are stored in `config.json` beside the exe (or source folder in dev):

```json
{
  "comPort": "COM3",
  "baudRate": 9600,
  "printerName": "Shop Counter",
  "apiKey": "sokasport-local-print-v1"
}
```

**Precedence:** `config.json` → env overrides (`PRINTER_COM`, `BAUD_RATE`, `PRINTER_API_KEY`) → auto-detect when `comPort` is empty.

Update at runtime via authenticated `POST /config`:

```json
{
  "comPort": "COM3",
  "baudRate": 9600,
  "printerName": "Shop Counter"
}
```

## Security

- Binds to **127.0.0.1 only** — never exposed on LAN
- All routes except `/health` and `/version` require header: `X-Printer-Key: sokasport-local-print-v1`
- CORS allows localhost and `https://admin.sokasport.com` (override via `CASHIER_ORIGINS` env)

## API

### `GET /version` (no auth)

```json
{ "version": "1.0.0", "protocolVersion": "1" }
```

### `GET /health` (no auth)

```json
{
  "ok": true,
  "uptimeSec": 3600,
  "connected": true,
  "queueLength": 0,
  "processing": false
}
```

### `GET /status` (auth required)

```json
{
  "success": true,
  "connected": true,
  "port": "COM3",
  "message": "Printer ready",
  "queueLength": 0,
  "processing": false,
  "lastError": null,
  "reconnectAttempts": 0,
  "lastSuccessfulPrintAt": "2026-05-22T12:00:00.000Z"
}
```

### `GET /printers` (auth required)

Lists available COM ports with metadata.

### `POST /print` (auth required)

Body: `{ "data": "<base64 ESC/POS bytes>" }`

Success: `{ "success": true, "port": "COM3", "jobId": "uuid" }`

### Auth header

```
X-Printer-Key: sokasport-local-print-v1
```

## Cashier UI

The admin app posts to `http://localhost:3005` with the API key header. Production build env:

```
VITE_PRINT_SERVICE_URL=http://localhost:3005
VITE_PRINTER_API_KEY=sokasport-local-print-v1
```

The cashier page polls `/status` every 7 seconds.

## Features

- FIFO print queue (one COM write at a time)
- Auto-reconnect every 5s after disconnect
- Write timeout protection (20s default)
- Structured JSON logs
- Protocol version handshake via `/version`

## Production startup

See [install/INSTALL.md](install/INSTALL.md) for cashier-facing steps (Task Scheduler / Startup folder + hidden VBS launcher).
