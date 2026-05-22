/**
 * Pure helpers for online payment verification (amount parsing, idempotency keys).
 */

const ONLINE_PAY_METHODS = new Set(["cbe", "cbebirr", "telebirr"]);

/**
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parseEtbMoneyString(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw).replace(/,/g, "").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeEthiopiaPhone(input) {
  let d = String(input ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = `251${d.slice(1)}`;
  if (d.length === 9) d = `251${d}`;
  return d;
}

/**
 * @param {unknown} s
 * @returns {string}
 */
export function sanitizePaySegment(s) {
  return String(s ?? "")
    .trim()
    .replace(/:/g, "-")
    .replace(/\s+/g, "");
}

/**
 * @param {string} method
 * @returns {method is "cbe" | "cbebirr" | "telebirr"}
 */
export function isOnlinePayMethod(method) {
  return ONLINE_PAY_METHODS.has(String(method || "").toLowerCase());
}

/**
 * @param {"cbe"|"cbebirr"|"telebirr"} method
 * @param {{ reference?: string, accountSuffix?: string, receiptNumber?: string, phoneNumber?: string }} parts
 * @returns {string|null}
 */
export function buildOnlinePayLedgerReference(method, parts) {
  const m = String(method).toLowerCase();
  const s = sanitizePaySegment;
  if (m === "telebirr") {
    const ref = s(parts.reference);
    return ref ? `online-pay:telebirr:${ref}` : null;
  }
  if (m === "cbe") {
    const ref = s(parts.reference);
    const suf = s(parts.accountSuffix);
    return ref && suf ? `online-pay:cbe:${ref}:${suf}` : null;
  }
  if (m === "cbebirr") {
    const rec = s(parts.receiptNumber);
    const phone = normalizeEthiopiaPhone(parts.phoneNumber);
    return rec && phone ? `online-pay:cbebirr:${rec}:${phone}` : null;
  }
  return null;
}

/**
 * @param {"cbe"|"cbebirr"|"telebirr"} method
 * @param {Record<string, unknown>} body
 * @returns {number|null}
 */
export function parseVerifiedAmountEtb(method, body) {
  const m = String(method).toLowerCase();
  if (m === "cbe") return parseEtbMoneyString(body?.amount);
  if (m === "cbebirr") {
    return (
      parseEtbMoneyString(body?.totalPaidAmount) ??
      parseEtbMoneyString(body?.paidAmount)
    );
  }
  if (m === "telebirr") {
    const data = body?.data && typeof body.data === "object" ? body.data : {};
    return parseEtbMoneyString(data.totalPaidAmount);
  }
  return null;
}

/**
 * @param {"cbe"|"cbebirr"|"telebirr"} method
 * @param {Record<string, unknown>} body
 * @returns {boolean}
 */
export function isSuccessfulVerification(method, body) {
  const m = String(method).toLowerCase();
  if (m === "cbe") return body?.success === true;
  if (m === "cbebirr") {
    return String(body?.transactionStatus ?? "").toLowerCase() === "completed";
  }
  if (m === "telebirr") {
    const data = body?.data && typeof body.data === "object" ? body.data : {};
    return (
      body?.success === true &&
      String(data.transactionStatus ?? "").toLowerCase() === "completed"
    );
  }
  return false;
}

/**
 * @param {number} declared
 * @param {number} verified
 * @param {number} [epsilon]
 * @returns {boolean}
 */
export function amountsMatch(declared, verified, epsilon = 0.01) {
  return Math.abs(declared - verified) <= epsilon;
}
