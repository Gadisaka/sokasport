/**
 * Local print bridge — receives Base64 ESC/POS bytes from the cashier UI
 * and writes them sequentially to a POS80 thermal printer via COM port.
 *
 * Env:
 *   PORT              — HTTP listen port (default 3005)
 *   PRINTER_COM       — COM port override (e.g. COM3)
 *   BAUD_RATE         — Serial baud rate override
 *   PRINTER_API_KEY   — API key override (default in config.json)
 *   CASHIER_ORIGINS   — Comma-separated allowed CORS origins
 *   WRITE_TIMEOUT_MS  — Per-job write timeout (default 20000)
 */

import cors from "cors";
import express from "express";
import { createAuthMiddleware } from "./auth.js";
import { ensureConfigFile, getEffectiveConfig, loadConfigFile, updateConfig } from "./config.js";
import { log } from "./logger.js";
import { PrintQueue } from "./printQueue.js";
import { classifySerialError, PrinterManager } from "./printerManager.js";
import { PROTOCOL_VERSION, VERSION } from "./version.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 3005;
const startedAt = Date.now();

if (HOST !== "127.0.0.1") {
  log("error", "security_warning", {
    message: "Printer bridge must bind to 127.0.0.1 only",
    host: HOST,
  });
  process.exit(1);
}

const DEFAULT_CORS_ORIGINS = [
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  /^https:\/\/admin\.sokasport\.com$/,
];

function buildCorsOriginChecker() {
  const extra = String(process.env.CASHIER_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (extra.includes(origin)) {
      callback(null, true);
      return;
    }
    const allowed = DEFAULT_CORS_ORIGINS.some((pattern) => pattern.test(origin));
    callback(null, allowed);
  };
}

const printerManager = new PrinterManager();
const printQueue = new PrintQueue(printerManager);

function buildStatusPayload(probeResult) {
  const managerState = printerManager.getState();
  const queueStats = printQueue.getStats();
  return {
    success: true,
    connected: probeResult.connected,
    port: probeResult.port || managerState.port,
    message: probeResult.message,
    code: probeResult.code,
    queueLength: queueStats.queueLength,
    processing: queueStats.processing,
    lastError: managerState.lastError,
    reconnectAttempts: managerState.reconnectAttempts,
    lastSuccessfulPrintAt: managerState.lastSuccessfulPrintAt,
    lastJobId: queueStats.lastJobId,
    lastJobStatus: queueStats.lastJobStatus,
  };
}

const app = express();
app.use(cors({ origin: buildCorsOriginChecker() }));
app.use(express.json({ limit: "4mb" }));
app.use(createAuthMiddleware());

app.get("/health", (_req, res) => {
  const managerState = printerManager.getState();
  const queueStats = printQueue.getStats();
  res.json({
    ok: true,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    connected: managerState.connected,
    queueLength: queueStats.queueLength,
    processing: queueStats.processing,
  });
});

app.get("/version", (_req, res) => {
  res.json({
    version: VERSION,
    protocolVersion: PROTOCOL_VERSION,
  });
});

app.get("/status", async (_req, res) => {
  try {
    const probeResult = await printerManager.probe();
    res.json(buildStatusPayload(probeResult));
  } catch (error) {
    const classified = classifySerialError(error);
    const managerState = printerManager.getState();
    const queueStats = printQueue.getStats();
    res.status(503).json({
      success: false,
      connected: false,
      port: managerState.port || getEffectiveConfig().comPort || "",
      message: classified.message,
      code: classified.code,
      queueLength: queueStats.queueLength,
      processing: queueStats.processing,
      lastError: managerState.lastError,
      reconnectAttempts: managerState.reconnectAttempts,
      lastSuccessfulPrintAt: managerState.lastSuccessfulPrintAt,
    });
  }
});

app.get("/printers", async (_req, res) => {
  try {
    const printers = await printerManager.listPrinters();
    res.json({ success: true, printers });
  } catch (error) {
    const classified = classifySerialError(error);
    res.status(503).json({
      success: false,
      message: classified.message,
      code: classified.code,
      printers: [],
    });
  }
});

app.post("/config", async (req, res) => {
  try {
    const body = req.body || {};
    const config = updateConfig({
      comPort: body.comPort,
      baudRate: body.baudRate,
      printerName: body.printerName,
    });
    await printerManager.applyConfig();
    const probeResult = await printerManager.probe();
    res.json({
      success: true,
      config,
      ...buildStatusPayload(probeResult),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error?.message || "Invalid config",
    });
  }
});

app.post("/print", async (req, res) => {
  const base64 = String(req.body?.data || "").trim();
  if (!base64) {
    res.status(400).json({
      success: false,
      code: "invalid_payload",
      message: "Missing Base64 ESC/POS data",
    });
    return;
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0) {
      throw new Error("Empty print payload");
    }
  } catch {
    res.status(400).json({
      success: false,
      code: "invalid_payload",
      message: "Invalid Base64 ESC/POS data",
    });
    return;
  }

  const result = await printQueue.enqueue(buffer);

  if (result.success) {
    res.json({
      success: true,
      port: result.port,
      jobId: result.jobId,
    });
    return;
  }

  res.status(503).json({
    success: false,
    code: result.code || "print_failed",
    message: result.message || "Print failed",
    port: result.port || "",
    jobId: result.jobId,
  });
});

async function start() {
  ensureConfigFile();
  const fileConfig = loadConfigFile();
  const effective = getEffectiveConfig();
  log("info", "config_loaded", {
    fileConfig: {
      comPort: fileConfig.comPort,
      baudRate: fileConfig.baudRate,
      printerName: fileConfig.printerName,
    },
    effective: {
      comPort: effective.comPort,
      baudRate: effective.baudRate,
    },
  });

  printerManager.startReconnectLoop();
  await printerManager.connect();

  app.listen(PORT, HOST, () => {
    log("info", "service_start", {
      host: HOST,
      port: PORT,
      version: VERSION,
      protocolVersion: PROTOCOL_VERSION,
      comPort: effective.comPort || "auto-detect",
      baudRate: effective.baudRate,
    });
  });
}

void start();
