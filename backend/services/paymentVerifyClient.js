/**
 * Server-side calls to external payment verification API.
 * Configure PAYMENT_VERIFY_BASE_URL and PAYMENT_VERIFY_API_KEY in backend/.env
 */

const PATHS = {
  cbe: "/verify-cbe",
  cbebirr: "/verify-cbebirr",
  telebirr: "/verify-telebirr",
};

/**
 * @returns {{ base: string, apiKey: string } | null}
 */
function getConfig() {
  const base = String(process.env.PAYMENT_VERIFY_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const apiKey = String(process.env.PAYMENT_VERIFY_API_KEY ?? "").trim();
  if (!base || !apiKey) return null;
  return { base, apiKey };
}

export function isPaymentVerifyConfigured() {
  return getConfig() !== null;
}

/**
 * @param {"cbe"|"cbebirr"|"telebirr"} method
 * @param {Record<string, string>} payload
 * @returns {Promise<{ ok: boolean, status: number, data: Record<string, unknown> }>}
 */
export async function verifyPaymentRemote(method, payload) {
  const cfg = getConfig();
  if (!cfg) {
    return {
      ok: false,
      status: 503,
      data: { message: "Verification is not configured" },
    };
  }

  const path = PATHS[method];
  if (!path) {
    return {
      ok: false,
      status: 400,
      data: { message: "Invalid payment method" },
    };
  }

  const url = `${cfg.base}${path}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    return {
      ok: res.ok,
      status: res.status,
      data: data && typeof data === "object" ? data : {},
    };
  } catch (err) {
    console.error("verifyPaymentRemote network error:", err?.message || err);
    return {
      ok: false,
      status: 502,
      data: { message: "Could not reach payment verification service" },
    };
  }
}
