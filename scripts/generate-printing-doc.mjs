import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function codeBlock(rel, lang = "") {
  const content = read(rel).replace(/\r\n/g, "\n");
  return `### \`${rel}\`\n\n\`\`\`${lang}\n${content}\`\`\`\n`;
}

function extractBlock(rel, startLine, endLine, lang = "javascript") {
  const lines = read(rel).split(/\r?\n/);
  const slice = lines.slice(startLine - 1, endLine).join("\n");
  return `### \`${rel}\` (lines ${startLine}-${endLine})\n\n\`\`\`${lang}\n${slice}\n\`\`\`\n`;
}

const header = `# Ticket Printing System — Complete Implementation Guide

> **Purpose:** Document the full end-to-end flow from the cashier Tickets page through the local PrinterBridge service to the physical thermal printer. Includes all source files needed to reimplement this on a similar system.
>
> **Last updated:** May 2026 · **Protocol version:** 1 · **Default bridge port:** 3005 (fallback 3006–3010)

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [End-to-end print sequence (sell ticket)](#2-end-to-end-print-sequence-sell-ticket)
3. [Reprint flow](#3-reprint-flow)
4. [Cashier PC setup (PrinterBridge)](#4-cashier-pc-setup-printerbridge)
5. [Environment variables & configuration](#5-environment-variables--configuration)
6. [HTTP API reference](#6-http-api-reference)
7. [Backend API (remote server)](#7-backend-api-remote-server)
8. [Error codes & troubleshooting](#8-error-codes--troubleshooting)
9. [Porting checklist for another system](#9-porting-checklist-for-another-system)
10. [Admin frontend source files](#10-admin-frontend-source-files)
11. [Backend source files](#11-backend-source-files)
12. [Printer service source files](#12-printer-service-source-files)
13. [Build & deploy](#13-build--deploy)

---

## 1. Architecture overview

Physical printing is **split across three layers**. The remote backend never talks to the printer directly. ESC/POS bytes are built **in the browser** and sent to a **localhost-only** bridge on the cashier PC.

\`\`\`
┌─────────────────────────────────────────────────────────────────────────────┐
│  Cashier browser (https://admin.sokasport.com)                              │
│  ┌─────────────────┐   ┌──────────────────┐   ┌─────────────────────────┐ │
│  │ TicketsPage.jsx │──▶│ escpos.js        │──▶│ Uint8Array ESC/POS bytes│ │
│  │ handlePrint()   │   │ encodeTicketAsync│   └───────────┬─────────────┘ │
│  └────────┬────────┘   └──────────────────┘               │ base64       │
│           │ validate / prepare / confirm                     ▼             │
│           │ (HTTPS)                              ┌───────────────────────┐ │
│           ▼                                      │ localPrinter.js       │ │
│  ┌─────────────────┐                             │ POST /print           │ │
│  │ api.sokasport   │                             └───────────┬───────────┘ │
│  │ .com backend    │                                         │             │
│  └─────────────────┘                                         │ localhost   │
└──────────────────────────────────────────────────────────────┼─────────────┘
                                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Cashier PC — PrinterBridge.exe (127.0.0.1:3005)                          │
│  index.js → printQueue.js → printerManager.js → windowsPrinters.js          │
│  PowerShell + Win32 WritePrinter (RAW) → Windows spooler queue "POS80"     │
└──────────────────────────────────────────────────────────────┬──────────────┘
                                                               │ USB
                                                               ▼
                                                    ┌─────────────────────┐
                                                    │ POS80 thermal printer│
                                                    └─────────────────────┘
\`\`\`

### Design decisions (important for porting)

| Decision | Rationale |
|----------|-----------|
| ESC/POS encoded in browser | No server-side font/image deps; bridge stays dumb transport |
| Wallet debited **after** physical print | Cashier sees paper before stake is taken |
| \`validate-print\` → \`prepare-print\` → local print → \`confirm-print\` | Odds checked twice; receipt number reserved before print |
| Bridge binds \`127.0.0.1\` only | LAN cannot reach cashier printer |
| Windows spooler RAW, not COM serial | Driver handles USB; queue name \`POS80\` must match \`config.json\` |
| Native \`node-printer\` disabled in pkg exe | Falls back to PowerShell \`WritePrinter\` (reliable on packaged build) |
| Strict queue match | Never auto-print to wrong device (e.g. phone PDF printer) |
| Idempotent \`confirm-print\` | Safe retries if network blips after successful print |

---

## 2. End-to-end print sequence (sell ticket)

### Phase A — User actions (Tickets page)

1. Cashier enters coupon on **Sell Ticket** tab → ticket loads (\`OPEN\` status).
2. Cashier sets stake and clicks **Confirm** → \`handleConfirmSell()\` → \`sellConfirmed = true\`.
3. Cashier clicks **Print Ticket** → \`handlePrint()\` runs (guarded by \`printInFlightRef\`).

### Phase B — Backend validation (remote API, HTTPS)

| Step | HTTP | Purpose |
|------|------|---------|
| 1 | \`POST /api/tickets/:id/validate-print\` | Dry-run odds/market validation. **No wallet debit.** Returns \`409\` if odds/market drifted. |
| 2 | \`POST /api/tickets/:id/prepare-print\` | Reserves unique \`receipt_number\` on OPEN ticket. **No wallet debit.** Returns full ticket for encoding. |

If step 1 returns \`odds_changed\` or \`market_version_changed\`, UI shows \`window.confirm()\`. On OK, retries with \`acceptOddsChanges: true\` and updated \`selections\`.

### Phase C — Local printer check

4. \`useTicketPrint\` polls \`GET http://localhost:3005/status\` every 7s (debounced: 3 failures before "offline").
5. If \`printerConnected === false\`, abort with user message.

### Phase D — ESC/POS encode + local print

6. \`encodeTicketAsync(ticket, { width: '80mm', platformWinningsTax })\` → \`Uint8Array\`:
   - INIT, centered logo raster (GS v 0), Code128 barcode raster, ticket body, partial cut.
7. \`printViaLocalService(escposData)\` → \`POST /print\` with \`{ "data": "<base64>" }\` and header \`X-Printer-Key\`.
8. Bridge decodes base64 → FIFO queue → \`PrinterManager.write()\` → PowerShell RAW to \`POS80\`.

### Phase E — Confirm sale (wallet debit)

9. \`PATCH /api/tickets/:id/confirm-print\` — inside DB transaction:
   - Re-validates odds (same drift handling).
   - Debits cashier wallet (\`BET\` transaction, reference \`ticket-print:{id}\`).
   - Sets ticket status \`OPEN\` → \`PRINTED\`.
10. UI refreshes slips + wallet; shows success. \`alreadyPrinted: true\` if idempotent retry.

### Sequence diagram

\`\`\`mermaid
sequenceDiagram
    participant Cashier as Cashier UI
    participant API as Remote Backend
    participant Bridge as PrinterBridge
    participant Win as Windows Spooler
    participant Printer as POS80

    Cashier->>API: POST validate-print
    API-->>Cashier: ok / 409 drift
    Cashier->>API: POST prepare-print
    API-->>Cashier: ticket + receiptNumber
    Cashier->>Cashier: encodeTicketAsync()
    Cashier->>Bridge: POST /print (base64 ESC/POS)
    Bridge->>Win: WritePrinter RAW
    Win->>Printer: USB bytes
    Bridge-->>Cashier: success + jobId
    Cashier->>API: PATCH confirm-print
    API-->>Cashier: deductedAmount, PRINTED
\`\`\`

---

## 3. Reprint flow

**Reprint does not hit the backend wallet APIs.** It only:

1. Loads ticket by ID (\`GET /api/tickets/:id\`).
2. Checks \`printerConnected\`.
3. \`encodeTicketAsync\` + \`printViaLocalService\`.

Used from the slips table **Reprint** button for already-PRINTED tickets.

---

## 4. Cashier PC setup (PrinterBridge)

### Prerequisites

1. Install POS80 thermal driver (\`POS80Setup_20200118.exe\`).
2. Connect printer USB-A → USB-B.
3. Verify Windows queue name is exactly **POS80** (Settings → Printers).

### Install bridge (no Node.js on cashier PC)

1. Copy entire \`printer-service/dist/\` folder to cashier PC.
2. Run \`Install-PrinterBridge.bat\`.
3. Installer copies to \`C:\\Sokasport\\PrinterBridge\\\`, writes \`config.json\`, adds Startup shortcut, starts exe.

### Verify

\`\`\`powershell
curl.exe http://127.0.0.1:3005/health
curl.exe -H "X-Printer-Key: sokasport-local-print-v1" http://127.0.0.1:3005/status
\`\`\`

Open admin Tickets page → green **Printer Connected (POS80)** → **Test Print**.

---

## 5. Environment variables & configuration

### Admin app (Vite build)

| Variable | Default | Purpose |
|----------|---------|---------|
| \`VITE_PRINT_SERVICE_URL\` | (auto-probe) | Fixed bridge URL e.g. \`http://localhost:3005\` |
| \`VITE_PRINTER_API_KEY\` | \`sokasport-local-print-v1\` | Must match bridge \`config.json\` |

### PrinterBridge (\`config.json\` + env)

| Key / Env | Default | Purpose |
|-----------|---------|---------|
| \`printerName\` / \`PRINTER_NAME\` | \`POS80\` | Windows queue name (strict match) |
| \`apiKey\` / \`PRINTER_API_KEY\` | \`sokasport-local-print-v1\` | Auth header |
| \`PORT\` | \`3005\` | Listen port |
| \`PORT_FALLBACK_ATTEMPTS\` | \`6\` | Try 3005–3010 |
| \`CASHIER_ORIGINS\` | — | Extra CORS origins (comma-separated) |
| \`WRITE_TIMEOUT_MS\` | \`60000\` | Per-job timeout |

---

## 6. HTTP API reference

### PrinterBridge (localhost)

| Method | Path | Auth | Body / Response |
|--------|------|------|-----------------|
| GET | \`/health\` | No | \`{ ok, listenPort, uptimeSec, connected, queueLength }\` |
| GET | \`/version\` | No | \`{ version, protocolVersion: "1" }\` |
| GET | \`/status\` | \`X-Printer-Key\` | \`{ connected, port, message, queueLength, processing, ... }\` |
| GET | \`/printers\` | Yes | Lists Windows queues |
| POST | \`/config\` | Yes | Update \`printerName\`, etc. |
| POST | \`/print\` | Yes | \`{ "data": "<base64 ESC/POS>" }\` → \`{ success, jobId }\` |

---

## 7. Backend API (remote server)

All require auth + \`tickets:create\` permission. Rate limited as \`cashier_confirm_print\`.

| Method | Path | Side effects |
|--------|------|--------------|
| POST | \`/api/tickets/:id/validate-print\` | None |
| POST | \`/api/tickets/:id/prepare-print\` | Assigns \`receipt_number\` |
| PATCH | \`/api/tickets/:id/confirm-print\` | Wallet debit + status PRINTED |

---

## 8. Error codes & troubleshooting

| Symptom | Code | Fix |
|---------|------|-----|
| Printer Offline in UI | \`service_unreachable\` | Start PrinterBridge; check port 3005–3010 |
| Auth failed | \`unauthorized\` | Match API keys |
| Queue not found | \`com_unavailable\` | Install driver; set \`printerName: "POS80"\` |
| 409 on confirm after print | — | Idempotency returns \`alreadyPrinted: true\` |
| WritePrinter -1 | — | Ensure \`SOKA_PRINTER_NAME\` env passed to PowerShell |
| Wrong printer used | — | Strict queue name; remove stray COM/virtual queues |
| Offline during long print | — | Status poll debounced (3 failures) |

---

## 9. Porting checklist for another system

- [ ] Replicate 3-step backend: validate → prepare → confirm (wallet after print)
- [ ] Browser ESC/POS encoder or equivalent byte generator
- [ ] Local HTTP bridge on \`127.0.0.1\` with API key + CORS for your admin origin
- [ ] RAW spooler write (Windows) or platform equivalent (CUPS raw on Linux)
- [ ] Status polling + debounce so long prints do not flash offline
- [ ] Port fallback (3005–3010) on bridge and client
- [ ] Idempotent confirm-print (check existing BET transaction)
- [ ] Windows queue name in config — **no silent fallback to first printer**
- [ ] Package as exe for cashiers without Node.js

---

`;

let body = header;

body += "\n## 10. Admin frontend source files\n\n";
const adminFiles = [
  "admin/src/services/localPrinter.js",
  "admin/src/components/ticket/escpos.js",
  "admin/src/components/ticket/ticketBarcode.js",
  "admin/src/components/ticket/useTicketPrint.js",
  "admin/src/pages/cashier/TicketsPage.jsx",
];
for (const f of adminFiles) {
  body += codeBlock(f, "javascript");
}

body += "\n### `admin/src/hook/useCashierTickets.js` (print mutations)\n\n```javascript\n";
const hookLines = read("admin/src/hook/useCashierTickets.js").split(/\r?\n/);
body += `${hookLines.slice(228).join("\n")}\n\`\`\`\n`;

body += "\n## 11. Backend source files\n\n";
body += codeBlock("backend/routes/tickets.js", "javascript");
body += codeBlock("backend/services/ticketPrintValidation.js", "javascript");
body += extractBlock("backend/controllers/ticketsController.js", 2322, 2835, "javascript");

body += "\n## 12. Printer service source files\n\n";
const printerFiles = [
  "printer-service/index.js",
  "printer-service/printerManager.js",
  "printer-service/windowsPrinters.js",
  "printer-service/printQueue.js",
  "printer-service/auth.js",
  "printer-service/config.js",
  "printer-service/listenPort.js",
  "printer-service/logger.js",
  "printer-service/version.js",
  "printer-service/package.json",
  "printer-service/dist/config.json",
  "printer-service/install/install.ps1",
  "printer-service/scripts/build-exe.mjs",
];
for (const f of printerFiles) {
  const lang = f.endsWith(".json")
    ? "json"
    : f.endsWith(".ps1")
      ? "powershell"
      : "javascript";
  body += codeBlock(f, lang);
}

body += `
## 13. Build & deploy

### Build PrinterBridge exe (developer machine)

\`\`\`bash
cd printer-service
npm install
npm run build:exe
\`\`\`

Output: \`dist/PrinterBridge.exe\`, \`dist/node_modules/\`, \`dist/config.json\`, \`dist/install/\`.

### Deploy admin

Set env vars at build time, deploy to your host. Cashiers use HTTPS admin; bridge stays local.

### Deploy backend

Ensure ticket print routes are mounted at \`/api/tickets\` with auth middleware.

---

*Generated from repository source. Re-run \`node scripts/generate-printing-doc.mjs\` after code changes.*
`;

const outPath = path.join(root, "docs", "TICKET_PRINTING_SYSTEM.md");
fs.writeFileSync(outPath, body, "utf8");
const stats = fs.statSync(outPath);
console.log(`Written ${outPath}`);
console.log(`Size: ${(stats.size / 1024).toFixed(1)} KB, lines: ${body.split("\n").length}`);
