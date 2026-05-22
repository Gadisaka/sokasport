/**
 * Local print bridge client — sends pre-encoded ESC/POS bytes to the
 * localhost Node printer-service (POS80 driver / COM port).
 */

const PRINT_SERVICE_URL =
  import.meta.env.VITE_PRINT_SERVICE_URL || "http://localhost:3005";

const PRINTER_API_KEY =
  import.meta.env.VITE_PRINTER_API_KEY || "sokasport-local-print-v1";

export const EXPECTED_PROTOCOL_VERSION = "1";

const STATUS_POLL_MS = 7000;

export { STATUS_POLL_MS };

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
    const res = await fetch(`${PRINT_SERVICE_URL}/version`, {
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
    const res = await fetch(`${PRINT_SERVICE_URL}/status`, {
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
    const res = await fetch(`${PRINT_SERVICE_URL}/printers`, {
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
    const res = await fetch(`${PRINT_SERVICE_URL}/config`, {
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
    const base64 = bytesToBase64(bytes);
    const res = await fetch(`${PRINT_SERVICE_URL}/print`, {
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
    return {
      success: false,
      code: "service_unreachable",
      error: {
        message: err?.message || "Local print service unreachable",
      },
    };
  }
}
