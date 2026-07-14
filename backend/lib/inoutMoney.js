/**
 * Formatting helpers for InOut responses.
 *
 * InOut expects money values as strings. ETB is fiat, so values are rounded to
 * 2 decimal places (crypto would use 9 — not used here).
 *
 * @module lib/inoutMoney
 */
import { toMoney } from "./moneyDecimal.js";

/**
 * Format a numeric balance/amount as a 2-decimal string for InOut.
 * @param {number|string} value
 * @returns {string}
 */
export function formatEtb(value) {
  return toMoney(value, 2).toFixed(2);
}
