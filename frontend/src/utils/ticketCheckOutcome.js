/**
 * Ticket-level outcome for the public Check-ticket receipt.
 *
 * Prefers the API `outcome` / `outcomeAmount` fields. Falls back to
 * `status` + `netPayout` when an older payload omits them (cashback
 * cannot be inferred without the server).
 */

const KNOWN_OUTCOMES = new Set([
  "pending",
  "won",
  "lost",
  "bonus",
  "void",
  "cancelled",
]);

const PENDING_STATUSES = new Set(["OPEN", "PRINTED", "HELD"]);
const WON_STATUSES = new Set(["WON", "PAID"]);
const CANCELLED_STATUSES = new Set(["CANCELED", "CASHED_OUT"]);

function parseAmount(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{ outcome?: string, outcomeAmount?: number|null, status?: string, netPayout?: number }} ticket
 * @returns {{ outcome: "pending"|"won"|"lost"|"bonus"|"void"|"cancelled", amount: number|null }}
 */
export function resolveTicketCheckOutcome(ticket) {
  const explicit = String(ticket?.outcome || "").toLowerCase();
  if (KNOWN_OUTCOMES.has(explicit)) {
    return { outcome: explicit, amount: parseAmount(ticket?.outcomeAmount) };
  }

  const status = String(ticket?.status || "").toUpperCase();
  if (PENDING_STATUSES.has(status)) {
    return { outcome: "pending", amount: null };
  }
  if (WON_STATUSES.has(status)) {
    return { outcome: "won", amount: parseAmount(ticket?.netPayout) };
  }
  if (status === "CASHBACK_PAID") {
    return { outcome: "bonus", amount: parseAmount(ticket?.outcomeAmount) };
  }
  if (status === "LOST") {
    return { outcome: "lost", amount: null };
  }
  if (status === "VOID") {
    return { outcome: "void", amount: null };
  }
  if (CANCELLED_STATUSES.has(status)) {
    return { outcome: "cancelled", amount: null };
  }
  return { outcome: "pending", amount: null };
}

/**
 * @param {number|null|undefined} amount
 * @returns {string|null}
 */
export function formatOutcomeAmount(amount) {
  const n = parseAmount(amount);
  if (n == null) return null;
  return `${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ETB`;
}
