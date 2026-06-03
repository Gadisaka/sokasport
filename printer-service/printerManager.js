import path from "path";
import { createRequire } from "module";
import { getEffectiveConfig } from "./config.js";
import { log } from "./logger.js";
import { PowerShellPrinter } from "./powershellPrinter.js";
import {
  getWindowsPrinterByName,
  listWindowsPrintersViaPowerShell,
} from "./windowsPrinters.js";

export const RECONNECT_INTERVAL_MS = 5000;
export const WRITE_TIMEOUT_MS = Number(process.env.WRITE_TIMEOUT_MS) || 60_000;
const PRINTER_LIST_TTL_MS = 60_000;
/** How long a verified connection is trusted before re-resolving the queue. */
const CONNECTION_TTL_MS = 30_000;
const DEFAULT_PRINTER_NAME = "POS80";

let printerApiPromise = null;
let nativePrinterDisabled = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPrinterApi() {
  if (nativePrinterDisabled) return null;
  if (printerApiPromise) return printerApiPromise;
  printerApiPromise = (async () => {
    try {
      if (process.pkg) {
        const base = path.dirname(process.execPath);
        const requireFromDisk = createRequire(
          path.join(base, "node_modules", "printer", "package.json"),
        );
        return requireFromDisk("printer");
      }
      const mod = await import("printer");
      return mod.default ?? mod;
    } catch (error) {
      nativePrinterDisabled = true;
      log("warn", "native_printer_disabled", {
        message: "Falling back to PowerShell printing",
        error: error?.message || "native module load failed",
      });
      return null;
    }
  })();
  return printerApiPromise;
}

function printerNameOf(entry) {
  return String(entry?.name || entry?.printer || entry?.deviceId || "").trim();
}

function equalsIgnoreCase(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

function normalizePrinterInfo(entry) {
  const name = printerNameOf(entry);
  return {
    path: name,
    manufacturer: String(entry?.driverName || entry?.manufacturer || "").trim(),
    serialNumber: "",
    vendorId: "",
    productId: "",
    friendlyName: String(entry?.portName || "").trim(),
    isDefault: Boolean(entry?.isDefault),
    status: String(entry?.status || "").trim(),
  };
}

export function classifySerialError(error) {
  const code = error?.code;
  if (code === "write_timeout") {
    return { code: "write_timeout", message: "Print write timed out" };
  }
  const msg = String(error?.message || error || "").toLowerCase();
  if (
    msg.includes("com port unavailable") ||
    msg.includes("no com port detected") ||
    msg.includes("no printer queue detected") ||
    msg.includes("invalid printer") ||
    msg.includes("printer queue unavailable") ||
    msg.includes("the printer name is invalid") ||
    msg.includes("printer not found")
  ) {
    return { code: "com_unavailable", message: "Printer queue unavailable" };
  }
  if (
    msg.includes("offline") ||
    msg.includes("disconnected") ||
    msg.includes("not connected") ||
    msg.includes("device not found")
  ) {
    return { code: "printer_disconnected", message: "Printer disconnected" };
  }
  return { code: "print_failed", message: error?.message || "Print failed" };
}

export class PrinterManager {
  constructor() {
    this.printerName = "";
    /** @type {"connected"|"disconnected"|"reconnecting"} */
    this.connectionState = "disconnected";
    this.reconnectAttempts = 0;
    this.lastError = null;
    this.lastSuccessfulPrintAt = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.reconnectTimer = null;
    /** @type {Array<any> | null} */
    this.cachedPrinters = null;
    this.cachedPrintersAt = 0;
    /** Timestamp of the last successful queue resolution (for connection caching). */
    this.lastConnectVerifiedAt = 0;
    this.psPrinter = new PowerShellPrinter();
  }

  async listQueues() {
    const now = Date.now();
    if (this.cachedPrinters && now - this.cachedPrintersAt < PRINTER_LIST_TTL_MS) {
      return this.cachedPrinters;
    }

    /** @type {Array<any>} */
    let printers = [];

    if (!nativePrinterDisabled) {
      try {
        const printerApi = await getPrinterApi();
        if (printerApi) {
          const native = await Promise.resolve(printerApi.getPrinters?.() || []);
          if (Array.isArray(native) && native.length > 0) {
            printers = native;
          }
        }
      } catch (error) {
        nativePrinterDisabled = true;
        log("warn", "native_printer_disabled", {
          error: error?.message || "Native printer enumeration failed",
        });
      }
    }

    if (printers.length === 0) {
      const fallback = await listWindowsPrintersViaPowerShell();
      if (fallback.length > 0) {
        printers = fallback;
      }
    }

    this.cachedPrinters = printers;
    this.cachedPrintersAt = now;
    return this.cachedPrinters;
  }

  async resolveQueueName() {
    const config = getEffectiveConfig();
    const preferred = String(
      process.env.PRINTER_NAME || config.printerName || DEFAULT_PRINTER_NAME,
    ).trim();

    // PowerShell path: never enumerate ALL queues (Get-Printer can block for
    // minutes on offline/network/redirected printers). Query just the
    // configured queue by name.
    if (nativePrinterDisabled) {
      if (!preferred) return "";
      const scoped = await getWindowsPrinterByName(preferred);
      return scoped ? scoped.name || preferred : "";
    }

    const printers = await this.listQueues();
    if (printers.length === 0) return "";

    const exact = printers.find((entry) =>
      equalsIgnoreCase(printerNameOf(entry), preferred),
    );
    if (exact) return printerNameOf(exact);

    // Strict mode: do NOT silently fall back to a different printer.
    // If the configured queue name does not exist, report disconnected.
    return "";
  }

  async forceDisconnect(error) {
    const message = error?.message || "Disconnected";
    this.connectionState = "disconnected";
    this.lastConnectVerifiedAt = 0;
    this.lastError = message;
    log("warn", "disconnect", { printer: this.printerName, error: message });
  }

  /**
   * Reuse an already-verified connection instead of re-resolving the queue on
   * every print. Only re-resolves when disconnected or the verification is
   * stale, which keeps the hot path free of repeated printer enumeration.
   */
  async ensureConnected() {
    if (
      this.connectionState === "connected" &&
      this.printerName &&
      Date.now() - this.lastConnectVerifiedAt < CONNECTION_TTL_MS
    ) {
      return true;
    }
    return this.connect();
  }

  async connect() {
    const config = getEffectiveConfig();
    const expected = String(
      process.env.PRINTER_NAME || config.printerName || DEFAULT_PRINTER_NAME,
    ).trim();
    // resolveQueueName already confirms the queue exists (native cached list or
    // a scoped `Get-Printer -Name`), so there is no need to enumerate again.
    const queueName = await this.resolveQueueName();
    if (!queueName) {
      this.connectionState = "disconnected";
      this.lastConnectVerifiedAt = 0;
      this.lastError = `Printer queue "${expected}" not found in Windows. Check Settings → Printers & scanners.`;
      return false;
    }

    this.printerName = queueName;
    this.connectionState = "connected";
    this.reconnectAttempts = 0;
    this.lastError = null;
    this.lastConnectVerifiedAt = Date.now();
    log("info", "connect", { printer: queueName });
    return true;
  }

  async sendRawWithNative(buffer, queueName) {
    const printerApi = await getPrinterApi();
    if (!printerApi) {
      throw Object.assign(new Error("native_unavailable"), {
        code: "native_unavailable",
      });
    }
    return new Promise((resolve, reject) => {
      try {
        printerApi.printDirect({
          data: buffer,
          printer: queueName,
          type: "RAW",
          docname: "Sokasport Ticket",
          success: () => resolve(),
          error: (err) => reject(err),
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async sendRawWithPowerShell(buffer, queueName) {
    const base64 = Buffer.from(buffer).toString("base64");
    const result = await this.psPrinter.print(queueName, base64, WRITE_TIMEOUT_MS);
    if (!result.ok) {
      const err = new Error(result.error || "PowerShell raw print failed");
      if (result.code) err.code = result.code;
      throw err;
    }
  }

  async sendRaw(buffer, queueName) {
    if (!nativePrinterDisabled) {
      try {
        await this.sendRawWithNative(buffer, queueName);
        return;
      } catch (err) {
        nativePrinterDisabled = true;
        log("warn", "native_print_disabled", {
          error: err?.message || "native print failed; falling back to PowerShell",
        });
      }
    }
    await this.sendRawWithPowerShell(buffer, queueName);
  }

  async write(buffer, timeoutMs = WRITE_TIMEOUT_MS, jobId = "") {
    const connected = await this.ensureConnected();
    if (!connected) {
      const err = new Error(this.lastError || "Printer not connected");
      throw err;
    }

    const start = Date.now();
    try {
      await Promise.race([
        this.sendRaw(buffer, this.printerName),
        sleep(timeoutMs).then(() => {
          const timeoutErr = new Error("Write timeout");
          timeoutErr.code = "write_timeout";
          throw timeoutErr;
        }),
      ]);
      this.lastSuccessfulPrintAt = new Date().toISOString();
      this.lastError = null;
      log("info", "print_success", {
        jobId,
        port: this.printerName,
        bytes: buffer.length,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      if (error?.code === "write_timeout") {
        log("error", "print_timeout", {
          jobId,
          printer: this.printerName,
          timeoutMs,
        });
      } else {
        log("error", "print_failure", {
          jobId,
          printer: this.printerName,
          error: error?.message || "Print failed",
        });
      }
      await this.forceDisconnect(error);
      throw error;
    }
  }

  startReconnectLoop() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(async () => {
      if (this.connectionState === "connected") return;
      this.reconnectAttempts += 1;
      log("info", "reconnect_attempt", { attempts: this.reconnectAttempts });
      const ok = await this.connect();
      if (ok) {
        log("info", "reconnect_success", {
          printer: this.printerName,
          attempts: this.reconnectAttempts,
        });
      }
    }, RECONNECT_INTERVAL_MS);
  }

  stopReconnectLoop() {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  getState() {
    return {
      connected: this.connectionState === "connected",
      port: this.printerName,
      connectionState: this.connectionState,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      lastSuccessfulPrintAt: this.lastSuccessfulPrintAt,
    };
  }

  async probe() {
    // Status is polled frequently; serve a recently verified connection from
    // cache instead of re-resolving the queue (and spawning PowerShell) each
    // time. A failed write resets lastConnectVerifiedAt, so genuine printer
    // loss is still surfaced quickly.
    if (
      this.connectionState === "connected" &&
      this.printerName &&
      Date.now() - this.lastConnectVerifiedAt < CONNECTION_TTL_MS
    ) {
      return {
        connected: true,
        port: this.printerName,
        message: "Printer ready",
      };
    }

    const resolvedQueue = await this.resolveQueueName();
    if (!resolvedQueue) {
      return {
        connected: false,
        port: "",
        message:
          "No printer queue detected. Install POS80 printer and verify Windows queue name.",
      };
    }

    const ok = await this.connect();
    if (ok) {
      return {
        connected: true,
        port: this.printerName || resolvedQueue,
        message: "Printer ready",
      };
    }

    const classified = classifySerialError(new Error(this.lastError || "Probe failed"));
    return {
      connected: false,
      port: resolvedQueue,
      message: this.lastError || classified.message,
      code: classified.code,
    };
  }

  async applyConfig() {
    this.cachedPrinters = null;
    this.cachedPrintersAt = 0;
    await this.forceDisconnect(new Error("Config updated"));
    return this.connect();
  }

  async listPrinters() {
    const printers = await this.listQueues();
    return printers.map(normalizePrinterInfo);
  }

  /** Release the persistent PowerShell worker and timers (process shutdown). */
  dispose() {
    this.stopReconnectLoop();
    this.psPrinter?.dispose?.();
  }
}
