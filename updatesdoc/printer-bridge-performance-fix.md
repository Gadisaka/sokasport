# Printer bridge — slow cashier printing fix (seconds to minutes → sub-second)

**Status:** Implemented (2026-06-03)  
**Last reviewed:** 2026-06-03  
**Scope:** `printer-service/` (PrinterBridge), minor admin poll interval

---

## Executive summary

Cashiers reported ticket printing taking **up to 5 minutes** after clicking Print. The admin app and ESC/POS encoding were fast; the bottleneck was the **local PrinterBridge** on Windows when it fell back to PowerShell (common when the native `printer` npm module fails inside a `pkg`-built exe).

The fix keeps the same architecture (browser → localhost bridge → Windows spooler → thermal printer) but removes repeated expensive work from the hot path:

| Before | After |
|--------|--------|
| New `powershell.exe` + `Add-Type` C# compile **per print** | **One** persistent PowerShell worker; `Add-Type` once per process |
| `Get-Printer` (all queues) on **every print** and **every status poll** | Scoped `Get-Printer -Name <queue>`; connection cached 30s |
| Status polled every **7s**, each probe re-resolving the queue | Probe serves cache when recently verified; poll **15s** |

Measured on a dev PC (native module unavailable, PowerShell path only): first print ~3–6s (worker cold start), subsequent prints **~90–400ms** in bridge logs.

---

## Symptom

| Observation | Detail |
|-------------|--------|
| When | Cashier clicks **Print** on a ticket |
| UI | Long wait before receipt emerges; sometimes feels “stuck” |
| Backend | Unaffected — delay is local to the cashier PC |
| Bridge | `POST /print` may not return for a long time; queue can back up |

---

## Architecture (unchanged)

```
Cashier browser (admin app)
  → encodeTicketAsync() → ESC/POS bytes (fast, cached logo/barcode)
  → POST http://127.0.0.1:3005/print (Base64 body)
PrinterBridge.exe (Node / pkg)
  → PrintQueue (serial)
  → PrinterManager.write()
  → Windows spooler RAW (POS80 or configured queue name)
Thermal printer
```

The admin app does **not** need redeploy for this fix — only **PrinterBridge** on each cashier machine.

---

## Root cause

### 1. Native printer module often unavailable in the exe

`PrinterBridge.exe` is built with `pkg`. The `printer` package’s `.node` binary frequently fails to load (`not a valid Win32 application` or missing beside the exe). On first failure, the bridge sets `nativePrinterDisabled = true` and **never** retries native for the process lifetime.

### 2. Per-print PowerShell with runtime C# compilation

Fallback used `spawn("powershell.exe", …)` per job with `Add-Type -TypeDefinition` for a Win32 `RawPrinterHelper` class. Each spawn pays:

- Cold PowerShell startup
- **Runtime C# compile** to `%TEMP%` (often scanned by Windows Defender / AMSI)

Under load this alone can be **tens of seconds per ticket**.

### 3. Full printer enumeration on every operation

`connect()` ran before every `write()`, calling `listQueues()` → `Get-Printer` **without** `-Name`. On PCs with offline, network, or RDP-redirected printers, Windows can block for **minutes** while querying each queue.

The cashier UI also polls `GET /status` every 7s; each poll called `probe()` → `connect()` → another enumeration, **competing** with print jobs for the same PowerShell/CPU/AV pipeline.

### 4. Serialization

All of the above ran through a single serial `PrintQueue`, so one slow status probe or slow print blocked everything behind it.

---

## Solution (four changes)

### A. Persistent PowerShell print worker

**New file:** `printer-service/powershellPrinter.js`

- Spawns **one** long-lived `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "<script>"`.
- Script runs `Add-Type` for `RawPrinterHelper` **once**, prints `READY`, then loops:
  - Read stdin line: `printerName<TAB>base64EscPos\n`
  - Write stdout line: `OK<TAB>bytesWritten` or `ERR<TAB>message`
- Node side: single outstanding job (queue already serial), per-job timeout, respawn worker on crash/timeout.
- C# helper extracted to shared constant `RAW_PRINTER_HELPER_CSHARP` in `windowsPrinters.js`.

**Removed:** `printRawViaPowerShell()` (spawn-per-print).

### B. Scoped printer lookup by name

**File:** `printer-service/windowsPrinters.js`

- Added `getWindowsPrinterByName(name)` using `Get-Printer -Name $env:SOKA_PRINTER_NAME` inside try/catch with `exit 0` so a missing queue returns empty output (no error storm on reconnect loop).
- Kept `listWindowsPrintersViaPowerShell()` only for admin `GET /printers`.

**File:** `printer-service/printerManager.js`

- When `nativePrinterDisabled`, `resolveQueueName()` uses scoped lookup instead of listing all queues.

### C. Connection caching on write

**File:** `printer-service/printerManager.js`

- `ensureConnected()`: if `connectionState === "connected"` and verified within `CONNECTION_TTL_MS` (30s), skip `connect()`.
- `write()` uses `ensureConnected()` instead of `connect()` every time.
- `connect()` no longer double-enumerates after `resolveQueueName()` already proved the queue exists.
- `PRINTER_LIST_TTL_MS` raised from 5s to **60s**; invalidate on `forceDisconnect` / `applyConfig`.

### D. Cheap status probes + less aggressive UI polling

**File:** `printer-service/printerManager.js`

- `probe()`: if connected and verified within 30s, return cached “Printer ready” without PowerShell.

**File:** `admin/src/services/localPrinter.js`

- `STATUS_POLL_MS`: **7000 → 15000** (optional but reduces background load).

### E. Lifecycle

**File:** `printer-service/index.js`

- `SIGINT` / `SIGTERM` / `exit` → `printerManager.dispose()` kills the PowerShell worker.

**File:** `printer-service/install/INSTALL.md`

- Troubleshooting row + Defender exclusion commands for slow printing.

---

## Files changed (this repo)

| File | Change |
|------|--------|
| `printer-service/powershellPrinter.js` | **New** — persistent worker |
| `printer-service/windowsPrinters.js` | Shared C# constant; `getWindowsPrinterByName`; removed per-print spawn |
| `printer-service/printerManager.js` | Worker routing, `ensureConnected`, cheap `probe`, TTLs |
| `printer-service/index.js` | Shutdown dispose |
| `printer-service/install/INSTALL.md` | AV exclusion guidance |
| `admin/src/services/localPrinter.js` | Status poll 15s |

---

## How to port this pattern to another project

Use this checklist if you have a similar **localhost print bridge** on Windows (ESC/POS → spooler RAW, optional native module + PowerShell fallback).

### 1. Identify the slow path

- Log `durationMs` per print job.
- Check logs for `native_printer_disabled` / falling back to PowerShell.
- Count `powershell.exe` spawns per print (Task Manager or Process Monitor).

### 2. Never `Add-Type` per job

**Anti-pattern:**

```text
each print → spawn powershell → Add-Type RawPrinterHelper → WritePrinter → exit
```

**Pattern:**

```text
bridge start → spawn powershell once → Add-Type once → loop on stdin → bridge stop → kill worker
```

Protocol suggestion (line-based, tab-separated):

| Direction | Format |
|-----------|--------|
| Host → worker | `queueName\t<base64 raw bytes>\n` |
| Worker → host | `OK\t<written>` or `ERR\t<message>\n` |
| Ready signal | `READY\n` after Add-Type |

Keep **one outstanding request** if the host queue is serial.

### 3. Never enumerate all printers on the hot path

**Anti-pattern:** `Get-Printer` with no `-Name` before every print and every health check.

**Pattern:**

- Resolve configured queue once: `Get-Printer -Name "POS80"` (or your queue name).
- Cache “connected” for 30–60s; invalidate only on write failure or config change.
- Full list endpoint only for setup UI (`/printers`).

### 4. Decouple health checks from print path

Status polls should read **cached state**, not re-probe hardware every N seconds. Re-probe only when:

- Cache expired
- Last print failed
- User opens printer settings

### 5. Optional: fix native path (separate effort)

Packaging `node-printer` with `pkg` is fragile. This project **did not** fix native loading; the worker makes PowerShell fast enough. For maximum speed, ship a prebuilt `.node` for the exact Node ABI or a tiny dedicated raw-print helper exe (no PowerShell).

### 6. Operational: antivirus

Document exclusions for the bridge folder, `PrinterBridge.exe`, and the long-lived `powershell.exe` worker child. AMSI on repeated `Add-Type` was a major contributor to multi-minute delays.

---

## Build and deploy (this project)

From repo root:

```bash
cd printer-service
npm install
npm run build:exe
```

Output: `printer-service/dist/PrinterBridge.exe`, `config.json`, `node_modules/`, `install/`, `Install-PrinterBridge.bat`.

**Cashier PC — full reinstall (same as before):**

1. Copy entire `dist/` folder to the machine.
2. Run `Install-PrinterBridge.bat` (installs to `C:\Sokasport\PrinterBridge\`, restarts bridge).

**Already installed with custom `config.json`:**

- Either back up `config.json`, run installer, restore settings, **or**
- Stop `PrinterBridge.exe`, replace only `PrinterBridge.exe`, start again.

No admin web redeploy required.

---

## Verification

### Bridge logs (JSON stdout)

Look for:

```json
{"event":"ps_worker_ready"}
{"event":"print_success","durationMs":90}
```

- First print after cold start: one `ps_worker_ready`, `durationMs` in low thousands (compile + startup).
- Second+ prints: **no** second `ps_worker_ready`, `durationMs` typically &lt; 500.

### Manual tests

| Test | Expected |
|------|----------|
| Three tickets in a row | 1st slower, 2nd/3rd fast |
| Print while status bar polling | No multi-minute stall |
| Unplug printer, print | Fails in ~1–2s with clear message, not 5 min |
| Restart bridge | First print warms worker again |

### HTTP smoke test (optional)

```bash
curl http://127.0.0.1:3005/health
curl -H "X-Printer-Key: <key>" http://127.0.0.1:3005/status
```

---

## Environment variables (optional tuning)

| Variable | Default | Purpose |
|----------|---------|---------|
| `WRITE_TIMEOUT_MS` | `60000` | Per-job write timeout in `PrinterManager` |
| `PS_WORKER_READY_TIMEOUT_MS` | `30000` | Max wait for worker `READY` after spawn |
| `PRINTER_NAME` | from `config.json` / `POS80` | Windows queue name |
| `PORT` | `3005` | HTTP listen port |

---

## Out of scope (documented for future work)

- Repairing native `printer` module load inside `pkg` exe
- Replacing PowerShell with a small C#/Go raw-print helper binary
- Linux/macOS spooler support (this bridge is Windows-only)

---

## Related docs in this repo

- `printer-service/install/INSTALL.md` — cashier install + AV exclusions
- `printer-service/README.md` — API endpoints
- `docs/TICKET_PRINTING_SYSTEM.md` — full print system (may predate this fix; regenerate with `scripts/generate-printing-doc.mjs` if needed)
