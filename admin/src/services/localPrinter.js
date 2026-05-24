/**
 * Local print bridge client — sends pre-encoded ESC/POS bytes to the
 * localhost Node printer-service (Windows spooler / POS80 queue).
 */

const DEFAULT_BASE_PORT = 3005;
const PORT_FALLBACK_ATTEMPTS = 6;
const BRIDGE_URL_STORAGE_KEY = "sokasport.printBridgeUrl";

const PRINTER_API_KEY =
  import.meta.env.VITE_PRINTER_API_KEY || "sokasport-local-print-v1";

export const EXPECTED_PROTOCOL_VERSION = "1";

const STATUS_POLL_MS = 7000;

export { STATUS_POLL_MS };

/** @type {string | null} */
let cachedBaseUrl = null;
let lastFailedProbeAt = 0;
const PROBE_COOLDOWN_MS = STATUS_POLL_MS;

function candidatePorts() {
  return Array.from(
    { length: PORT_FALLBACK_ATTEMPTS },
    (_, index) => DEFAULT_BASE_PORT + index,
  );
}

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function buildLocalUrl(port) {
  return `http://localhost:${port}`;
}

async function pingBridge(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(1500),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.ok === true;
  } catch {
    return false;
  }
}

/**
 * Resolve bridge base URL: env override → session cache → probe 3005..3010.
 * @returns {Promise<string>}
 */
export async function resolvePrintServiceUrl() {
  if (cachedBaseUrl) return cachedBaseUrl;

  if (Date.now() - lastFailedProbeAt < PROBE_COOLDOWN_MS) {
    return buildLocalUrl(DEFAULT_BASE_PORT);
  }

  const fromEnv = normalizeBaseUrl(import.meta.env.VITE_PRINT_SERVICE_URL);
  if (fromEnv) {
    cachedBaseUrl = fromEnv;
    return cachedBaseUrl;
  }

  try {
    const stored = normalizeBaseUrl(sessionStorage.getItem(BRIDGE_URL_STORAGE_KEY));
    if (stored && (await pingBridge(stored))) {
      cachedBaseUrl = stored;
      lastFailedProbeAt = 0;
      return cachedBaseUrl;
    }
  } catch {
    // sessionStorage unavailable — continue probing
  }

  for (const port of candidatePorts()) {
    const candidate = buildLocalUrl(port);
    if (await pingBridge(candidate)) {
      cachedBaseUrl = candidate;
      lastFailedProbeAt = 0;
      try {
        sessionStorage.setItem(BRIDGE_URL_STORAGE_KEY, candidate);
      } catch {
        // ignore
      }
      return cachedBaseUrl;
    }
  }

  lastFailedProbeAt = Date.now();
  return buildLocalUrl(DEFAULT_BASE_PORT);
}

function authHeaders(extra = {}) {
  return {
    "X-Printer-Key": PRINTER_API_KEY,
    ...extra,
  };
}

function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < view.length; i += chunkSize) {
    binary += String.fromCharCode(...view.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function normalizeStatus(data, ok = true) {
  return {
    success: ok,
    connected: Boolean(data.connected),
    port: data.port || "",
    message: data.message || "",
    code: data.code,
    queueLength: Number(data.queueLength) || 0,
    processing: Boolean(data.processing),
    lastError: data.lastError || null,
    reconnectAttempts: Number(data.reconnectAttempts) || 0,
    lastSuccessfulPrintAt: data.lastSuccessfulPrintAt || null,
  };
}

/**
 * @returns {Promise<{ success: boolean, version?: string, protocolVersion?: string, code?: string }>}
 */
export async function getVersion() {
  try {
    const baseUrl = await resolvePrintServiceUrl();
    const res = await fetch(`${baseUrl}/version`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, code: "version_failed" };
    }
    return {
      success: true,
      version: data.version,
      protocolVersion: data.protocolVersion,
    };
  } catch {
    cachedBaseUrl = null;
    return { success: false, code: "service_unreachable" };
  }
}

/**
 * @returns {Promise<{ compatible: boolean, warning?: string, code?: string }>}
 */
export async function checkBridgeCompatibility() {
  const versionInfo = await getVersion();
  if (!versionInfo.success) {
    return { compatible: false, code: versionInfo.code || "service_unreachable" };
  }
  if (versionInfo.protocolVersion !== EXPECTED_PROTOCOL_VERSION) {
    return {
      compatible: false,
      warning:
        "Printer bridge outdated — contact support to update PrinterBridge.exe",
      code: "protocol_mismatch",
    };
  }
  return { compatible: true };
}

/**
 * @returns {Promise<ReturnType<typeof normalizeStatus>>}
 */
export async function getStatus() {
  try {
    const baseUrl = await resolvePrintServiceUrl();
    const res = await fetch(`${baseUrl}/status`, {
      method: "GET",
      headers: authHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      return {
        success: false,
        connected: false,
        port: "",
        message: "Printer bridge auth failed — check API key",
        code: "unauthorized",
        queueLength: 0,
        processing: false,
        lastError: null,
        reconnectAttempts: 0,
        lastSuccessfulPrintAt: null,
      };
    }
    if (!res.ok) {
      return normalizeStatus(data, false);
    }
    return normalizeStatus(data, true);
  } catch {
    cachedBaseUrl = null;
    return {
      success: false,
      connected: false,
      port: "",
      message: "Local print service unreachable",
      code: "service_unreachable",
      queueLength: 0,
      processing: false,
      lastError: null,
      reconnectAttempts: 0,
      lastSuccessfulPrintAt: null,
    };
  }
}

/**
 * @returns {Promise<{ success: boolean, printers?: Array<{ path: string, manufacturer: string, serialNumber: string, vendorId: string, productId: string }>, code?: string, message?: string }>}
 */
export async function listPrinters() {
  try {
    const baseUrl = await resolvePrintServiceUrl();
    const res = await fetch(`${baseUrl}/printers`, {
      method: "GET",
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        printers: [],
        code: data.code || "list_failed",
        message: data.message || "Failed to list printers",
      };
    }
    return {
      success: true,
      printers: Array.isArray(data.printers) ? data.printers : [],
    };
  } catch {
    cachedBaseUrl = null;
    return {
      success: false,
      printers: [],
      code: "service_unreachable",
      message: "Local print service unreachable",
    };
  }
}

/**
 * @param {{ comPort?: string, baudRate?: number, printerName?: string }} payload
 */
export async function updateConfig(payload) {
  try {
    const baseUrl = await resolvePrintServiceUrl();
    const res = await fetch(`${baseUrl}/config`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        message: data.message || "Failed to update printer config",
      };
    }
    return { success: true, config: data.config, status: normalizeStatus(data, true) };
  } catch (err) {
    cachedBaseUrl = null;
    return {
      success: false,
      message: err?.message || "Local print service unreachable",
    };
  }
}

/**
 * @param {Uint8Array} bytes - ESC/POS command bytes from encodeTicketAsync()
 * @returns {Promise<{ success: boolean, code?: string, jobId?: string, error?: { message: string } }>}
 */
export async function print(bytes) {
  try {
    const baseUrl = await resolvePrintServiceUrl();
    const base64 = bytesToBase64(bytes);
    const res = await fetch(`${baseUrl}/print`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ data: base64 }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      return {
        success: false,
        code: "unauthorized",
        error: { message: "Printer bridge auth failed — check API key" },
      };
    }

    if (res.ok && data.success) {
      return { success: true, jobId: data.jobId };
    }

    return {
      success: false,
      code: data.code || "print_failed",
      jobId: data.jobId,
      error: {
        message: data.message || data.error || "Print failed",
      },
    };
  } catch (err) {
    cachedBaseUrl = null;
    return {
      success: false,
      code: "service_unreachable",
      error: {
        message: err?.message || "Local print service unreachable",
      },
    };
  }
}
