import crypto from "crypto";

export const SHOP_WITHDRAW_REF_PREFIX = "pending:shop-withdraw:";

/** Default TTL for unredeemed shop codes (ms). */
export const SHOP_WITHDRAW_TTL_MS = 30 * 60 * 1000;

function withdrawCodeSecret() {
  return process.env.SHOP_WITHDRAW_CODE_SECRET || process.env.JWT_SECRET || "";
}

/**
 * @returns {string} Six-digit string "000000".."999999"
 */
export function generateSixDigitCode() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

/**
 * @param {string} normalizedSixDigits
 * @returns {string} hex digest for unique lookup
 */
export function digestShopWithdrawCode(normalizedSixDigits) {
  const secret = withdrawCodeSecret();
  return crypto.createHmac("sha256", secret).update(normalizedSixDigits, "utf8").digest("hex");
}

/**
 * @param {string} raw
 * @returns {string | null} normalized 6-digit code or null
 */
export function normalizeSixDigitWithdrawCode(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d{6}$/.test(s)) return null;
  return s;
}
