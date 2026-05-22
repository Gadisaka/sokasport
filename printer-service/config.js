import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

function getModuleDir() {
  if (typeof __dirname !== "undefined") {
    return __dirname;
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

const isPackaged = Boolean(process.pkg);
export const BASE_DIR = isPackaged ? path.dirname(process.execPath) : getModuleDir();
export const CONFIG_PATH = path.join(BASE_DIR, "config.json");

export const DEFAULT_API_KEY = "sokasport-local-print-v1";

const DEFAULTS = {
  comPort: "",
  baudRate: 9600,
  printerName: "",
  apiKey: DEFAULT_API_KEY,
};

export function ensureConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfigFile({ ...DEFAULTS });
    log("info", "config_created", { path: CONFIG_PATH });
  }
}

export function loadConfigFile() {
  ensureConfigFile();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfigFile(config) {
  const next = {
    comPort: String(config.comPort ?? "").trim(),
    baudRate: Number(config.baudRate) || 9600,
    printerName: String(config.printerName ?? "").trim(),
    apiKey: String(config.apiKey ?? DEFAULT_API_KEY).trim() || DEFAULT_API_KEY,
  };
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function getApiKey() {
  const file = loadConfigFile();
  const envKey = String(process.env.PRINTER_API_KEY || "").trim();
  return envKey || file.apiKey || DEFAULT_API_KEY;
}

/** config.json with env overrides (PRINTER_COM, BAUD_RATE). */
export function getEffectiveConfig() {
  const file = loadConfigFile();
  const envCom = String(process.env.PRINTER_COM || "").trim();
  const envBaud = Number(process.env.BAUD_RATE);
  return {
    comPort: envCom || file.comPort || "",
    baudRate: Number.isFinite(envBaud) && envBaud > 0 ? envBaud : file.baudRate || 9600,
    printerName: file.printerName || "",
    apiKey: getApiKey(),
  };
}

/**
 * @param {{ comPort?: string, baudRate?: number, printerName?: string }} partial
 */
export function updateConfig(partial) {
  const current = loadConfigFile();
  const next = { ...current };
  if (partial.comPort !== undefined) {
    next.comPort = String(partial.comPort).trim();
  }
  if (partial.baudRate !== undefined) {
    const baud = Number(partial.baudRate);
    if (!Number.isFinite(baud) || baud <= 0) {
      throw new Error("baudRate must be a positive number");
    }
    next.baudRate = baud;
  }
  if (partial.printerName !== undefined) {
    next.printerName = String(partial.printerName).trim();
  }
  saveConfigFile(next);
  log("info", "config_updated", {
    config: {
      comPort: next.comPort,
      baudRate: next.baudRate,
      printerName: next.printerName,
    },
  });
  return getEffectiveConfig();
}
