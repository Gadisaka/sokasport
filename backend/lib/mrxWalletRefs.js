/**
 * Pure validation + MRX wallet reference helpers (no DB).
 * @module lib/mrxWalletRefs
 */

export function feeRef(id) {
  const raw = String(id ?? "");
  return raw.startsWith("mrx:") ? raw : `mrx:fee:${raw}`;
}

export function winRef(id) {
  const raw = String(id ?? "");
  return raw.startsWith("mrx:") ? raw : `mrx:win:${raw}`;
}

/**
 * Validate adjust-balance body fields.
 * @param {unknown} body
 * @returns {{ ok: true, phone: string, type: "GAME_FEE"|"GAME_WINNING", amount: number, referenceId: string } | { ok: false, message: string }}
 */
export function parseAdjustBalanceBody(body) {
  const { phone, type, amount, reference } = body ?? {};

  if (!phone || !type || amount == null) {
    return {
      ok: false,
      message: "phone, type, and amount are required",
    };
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return {
      ok: false,
      message: "amount must be a positive number",
    };
  }

  if (!["GAME_FEE", "GAME_WINNING"].includes(type)) {
    return {
      ok: false,
      message: 'type must be "GAME_FEE" or "GAME_WINNING"',
    };
  }

  const referenceId =
    reference != null && String(reference).trim()
      ? String(reference).trim()
      : `${String(phone).replace(/\D/g, "") || "unknown"}-${Date.now()}`;

  return {
    ok: true,
    phone: String(phone),
    type,
    amount: parsedAmount,
    referenceId,
  };
}
