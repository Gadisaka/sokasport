import { getEffectiveConfig } from "./config.js";
import { log } from "./logger.js";
import { getSerialPort } from "./serialportLoader.js";

export const RECONNECT_INTERVAL_MS = 5000;
export const WRITE_TIMEOUT_MS = Number(process.env.WRITE_TIMEOUT_MS) || 20_000;
const PORT_LIST_TTL_MS = 5000;

export function classifySerialError(error) {
  const code = error?.code;
  if (code === "write_timeout") {
    return { code: "write_timeout", message: "Print write timed out" };
  }
  const msg = String(error?.message || error || "").toLowerCase();
  if (
    msg.includes("com port unavailable") ||
    msg.includes("no com port detected") ||
    msg.includes("printer not connected")
  ) {
    return { code: "com_unavailable", message: "COM port unavailable" };
  }
  if (
    msg.includes("access denied") ||
    msg.includes("cannot open") ||
    msg.includes("file not found") ||
    msg.includes("enoent") ||
    msg.includes("eacces") ||
    msg.includes("error code 121") ||
    msg.includes("unknown error code 121") ||
    msg.includes("port not open")
  ) {
    return { code: "com_unavailable", message: "COM port unavailable" };
  }
  if (
    msg.includes("disconnected") ||
    msg.includes("not connected") ||
    msg.includes("device not found")
  ) {
    return { code: "printer_disconnected", message: "Printer disconnected" };
  }
  return { code: "print_failed", message: error?.message || "Print failed" };
}

export function parsePnpIds(pnpId) {
  const raw = String(pnpId || "");
  const vendorId = raw.match(/VID_([0-9A-F]{4})/i)?.[1]?.toLowerCase() || "";
  const productId = raw.match(/PID_([0-9A-F]{4})/i)?.[1]?.toLowerCase() || "";
  return { vendorId, productId };
}

export function mapPortInfo(port) {
  const { vendorId, productId } = parsePnpIds(port.pnpId);
  return {
    path: port.path || "",
    manufacturer: port.manufacturer || "",
    serialNumber: port.serialNumber || "",
    vendorId,
    productId,
    friendlyName: port.friendlyName || "",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PrinterManager {
  constructor() {
    /** @type {import("serialport").SerialPort | null} */
    this.port = null;
    this.comPath = "";
    /** @type {"connected"|"disconnected"|"reconnecting"} */
    this.connectionState = "disconnected";
    this.reconnectAttempts = 0;
    this.lastError = null;
    this.lastSuccessfulPrintAt = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.reconnectTimer = null;
    /** @type {import("serialport").PortInfo[] | null} */
    this.cachedPortList = null;
    this.cachedPortListAt = 0;
  }

  async listPorts() {
    const now = Date.now();
    if (this.cachedPortList && now - this.cachedPortListAt < PORT_LIST_TTL_MS) {
      return this.cachedPortList;
    }
    try {
      const SerialPort = await getSerialPort();
      this.cachedPortList = await SerialPort.list();
      this.cachedPortListAt = now;
      return this.cachedPortList;
    } catch {
      return [];
    }
  }

  async resolveComPort() {
    const config = getEffectiveConfig();
    if (config.comPort) return config.comPort;

    const ports = await this.listPorts();
    const pos80 = ports.find(
      (p) =>
        /pos80|pos-?80|thermal|receipt|printer/i.test(p.manufacturer || "") ||
        /pos80|pos-?80|thermal|receipt|printer/i.test(p.friendlyName || "") ||
        /pos80|pos-?80|thermal|receipt|printer/i.test(p.pnpId || ""),
    );
    if (pos80?.path) return pos80.path;

    const usbSerial = ports.find((p) =>
      /usb|serial/i.test(
        `${p.manufacturer || ""} ${p.friendlyName || ""} ${p.pnpId || ""}`,
      ),
    );
    return usbSerial?.path || ports[0]?.path || "";
  }

  async openPort(comPath, baudRate) {
    const SerialPort = await getSerialPort();
    return new Promise((resolve, reject) => {
      const port = new SerialPort({
        path: comPath,
        baudRate,
        autoOpen: false,
      });

      port.open((err) => {
        if (err) {
          port.destroy();
          reject(err);
          return;
        }
        this.port = port;
        port.on("error", (portErr) => {
          log("warn", "disconnect", {
            port: this.comPath,
            error: portErr?.message || "port error",
          });
          void this.forceDisconnect(portErr);
        });
        port.on("close", () => {
          if (this.connectionState === "connected") {
            void this.forceDisconnect(new Error("Port closed unexpectedly"));
          }
        });
        resolve();
      });
    });
  }

  closePort() {
    return new Promise((resolve) => {
      if (!this.port) {
        resolve();
        return;
      }
      const port = this.port;
      this.port = null;
      if (!port.isOpen) {
        port.destroy();
        resolve();
        return;
      }
      port.close(() => {
        port.destroy();
        resolve();
      });
    });
  }

  async forceDisconnect(error) {
    const message = error?.message || "Disconnected";
    this.connectionState = "disconnected";
    this.lastError = message;
    await this.closePort();
    log("warn", "disconnect", { port: this.comPath, error: message });
  }

  async connect() {
    const config = getEffectiveConfig();
    const comPath = config.comPort || (await this.resolveComPort());
    if (!comPath) {
      this.connectionState = "disconnected";
      this.lastError = "No COM port detected. Install POS80 driver and connect printer.";
      return false;
    }

    if (
      this.connectionState === "connected" &&
      this.port?.isOpen &&
      this.comPath === comPath
    ) {
      return true;
    }

    this.connectionState = "reconnecting";
    await this.closePort();

    try {
      await this.openPort(comPath, config.baudRate);
      this.comPath = comPath;
      this.connectionState = "connected";
      this.reconnectAttempts = 0;
      this.lastError = null;
      log("info", "connect", { port: comPath, baudRate: config.baudRate });
      return true;
    } catch (error) {
      this.connectionState = "disconnected";
      const classified = classifySerialError(error);
      this.lastError = classified.message;
      await this.closePort();
      return false;
    }
  }

  writeAndDrain(buffer) {
    return new Promise((resolve, reject) => {
      if (!this.port?.isOpen) {
        reject(new Error("Port not open"));
        return;
      }
      this.port.write(buffer, (writeErr) => {
        if (writeErr) {
          reject(writeErr);
          return;
        }
        this.port.drain((drainErr) => {
          if (drainErr) reject(drainErr);
          else resolve();
        });
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
    try {
      await Promise.race([
        this.writeAndDrain(buffer),
        sleep(timeoutMs).then(() => {
          const timeoutErr = new Error("Write timeout");
          timeoutErr.code = "write_timeout";
          throw timeoutErr;
        }),
      ]);
      this.lastSuccessfulPrintAt = new Date().toISOString();
      log("info", "print_success", {
        jobId,
        port: this.comPath,
        bytes: buffer.length,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      if (error?.code === "write_timeout") {
        log("error", "print_timeout", { jobId, port: this.comPath, timeoutMs });
      } else {
        log("error", "print_failure", {
          jobId,
          port: this.comPath,
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
          port: this.comPath,
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
      connected: this.connectionState === "connected" && Boolean(this.port?.isOpen),
      port: this.comPath,
      connectionState: this.connectionState,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      lastSuccessfulPrintAt: this.lastSuccessfulPrintAt,
    };
  }

  async probe() {
    const config = getEffectiveConfig();
    const resolvedPort = config.comPort || (await this.resolveComPort());
    if (!resolvedPort) {
      return {
        connected: false,
        port: "",
        message: "No COM port detected. Install POS80 driver and connect printer.",
      };
    }

    const ok = await this.connect();
    if (ok) {
      return {
        connected: true,
        port: this.comPath || resolvedPort,
        message: "Printer ready",
      };
    }

    const classified = classifySerialError(new Error(this.lastError || "Probe failed"));
    return {
      connected: false,
      port: resolvedPort,
      message: this.lastError || classified.message,
      code: classified.code,
    };
  }

  async applyConfig() {
    this.cachedPortList = null;
    this.cachedPortListAt = 0;
    await this.forceDisconnect(new Error("Config updated"));
    return this.connect();
  }

  async listPrinters() {
    const ports = await this.listPorts();
    return ports.map(mapPortInfo);
  }
}
