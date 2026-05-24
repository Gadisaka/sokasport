import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { createRequire } from "module";
import { getEffectiveConfig } from "./config.js";
import { log } from "./logger.js";

export const RECONNECT_INTERVAL_MS = 5000;
export const WRITE_TIMEOUT_MS = Number(process.env.WRITE_TIMEOUT_MS) || 60_000;
const PRINTER_LIST_TTL_MS = 5000;
const DEFAULT_PRINTER_NAME = "POS80";

let printerApiPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPrinterApi() {
  if (printerApiPromise) return printerApiPromise;
  printerApiPromise = (async () => {
    if (process.pkg) {
      const base = path.dirname(process.execPath);
      const requireFromDisk = createRequire(
        path.join(base, "node_modules", "printer", "package.json"),
      );
      return requireFromDisk("printer");
    }
    const mod = await import("printer");
    return mod.default ?? mod;
  })();
  return printerApiPromise;
}

function printerNameOf(entry) {
  return String(entry?.name || entry?.printer || entry?.deviceId || "").trim();
}

function equalsIgnoreCase(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

function printerLooksLikePos80(entry) {
  return /pos80|pos-?80|thermal|receipt/i.test(
    `${entry?.name || ""} ${entry?.driverName || ""} ${entry?.portName || ""}`,
  );
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
  }

  async listQueues() {
    const now = Date.now();
    if (this.cachedPrinters && now - this.cachedPrintersAt < PRINTER_LIST_TTL_MS) {
      return this.cachedPrinters;
    }
    try {
      const printerApi = await getPrinterApi();
      const printers = await Promise.resolve(printerApi.getPrinters?.() || []);
      this.cachedPrinters = Array.isArray(printers) ? printers : [];
      this.cachedPrintersAt = now;
      return this.cachedPrinters;
    } catch {
      return [];
    }
  }

  async resolveQueueName() {
    const config = getEffectiveConfig();
    const preferred = String(
      process.env.PRINTER_NAME || config.printerName || DEFAULT_PRINTER_NAME,
    ).trim();
    const printers = await this.listQueues();
    if (printers.length === 0) return "";

    if (preferred) {
      const exact = printers.find((entry) =>
        equalsIgnoreCase(printerNameOf(entry), preferred),
      );
      if (exact) return printerNameOf(exact);
    }

    const pos80 = printers.find(printerLooksLikePos80);
    if (pos80) return printerNameOf(pos80);

    const defaultQueue = printers.find((entry) => Boolean(entry?.isDefault));
    return printerNameOf(defaultQueue || printers[0]);
  }

  async forceDisconnect(error) {
    const message = error?.message || "Disconnected";
    this.connectionState = "disconnected";
    this.lastError = message;
    log("warn", "disconnect", { printer: this.printerName, error: message });
  }

  async connect() {
    const queueName = await this.resolveQueueName();
    if (!queueName) {
      this.connectionState = "disconnected";
      this.lastError =
        "No printer queue detected. Install POS80 printer and verify Windows queue name.";
      return false;
    }

    const printers = await this.listQueues();
    const exists = printers.some((entry) =>
      equalsIgnoreCase(printerNameOf(entry), queueName),
    );
    if (!exists) {
      this.connectionState = "disconnected";
      this.lastError = `Printer queue unavailable: ${queueName}`;
      return false;
    }

    this.printerName = queueName;
    this.connectionState = "connected";
    this.reconnectAttempts = 0;
    this.lastError = null;
    log("info", "connect", { printer: queueName });
    return true;
  }

  async printFile(filename, queueName) {
    const printerApi = await getPrinterApi();
    return new Promise((resolve, reject) => {
      printerApi.printFile({
        filename,
        printer: queueName,
        success: () => resolve(),
        error: (err) => reject(err),
      });
    });
  }

  async write(buffer, timeoutMs = WRITE_TIMEOUT_MS, jobId = "") {
    const connected = await this.connect();
    if (!connected) {
      const err = new Error(this.lastError || "Printer not connected");
      throw err;
    }

    const start = Date.now();
    const tempFile = path.join(
      os.tmpdir(),
      `sokasport-escpos-${jobId || Date.now()}.bin`,
    );
    try {
      await fs.writeFile(tempFile, buffer);
      await Promise.race([
        this.printFile(tempFile, this.printerName),
        sleep(timeoutMs).then(() => {
          const timeoutErr = new Error("Write timeout");
          timeoutErr.code = "write_timeout";
          throw timeoutErr;
        }),
      ]);
      this.lastSuccessfulPrintAt = new Date().toISOString();
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
    } finally {
      await fs.unlink(tempFile).catch(() => {});
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
}
