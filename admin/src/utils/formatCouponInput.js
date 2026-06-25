/**
 * Formats coupon/receipt input as #####-##### while typing (max 10 digits).
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function formatCouponInput(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
