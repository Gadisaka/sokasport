/**
 * Cashier UX guard — mirrors backend/lib/bettingLimits.js and frontend stakeLimits.js.
 */

/**
 * @param {Record<string, number|null|undefined>} limits
 * @param {number} grossPotentialWin
 * @returns {number}
 */
export function capGrossPotentialWin(limits, grossPotentialWin) {
  const maxWin = limits?.MAX_WINNING_AMOUNT;
  const g = Math.round(Number(grossPotentialWin) * 100) / 100;
  if (maxWin == null || !Number.isFinite(maxWin)) return g;
  return Math.min(g, Math.round(maxWin * 100) / 100);
}

export function stakeAndPotentialWinViolation(limits, stake) {
  const minBet = limits?.MIN_BET_AMOUNT;
  const maxBet = limits?.MAX_BET_AMOUNT;

  if (minBet != null && Number.isFinite(minBet) && stake < minBet) {
    return `Minimum stake is ${minBet} ETB`;
  }
  if (maxBet != null && Number.isFinite(maxBet) && stake > maxBet) {
    return `Maximum stake is ${maxBet} ETB`;
  }
  return null;
}

export function stakeLimitsHintParts(limits) {
  const parts = [];
  if (
    limits?.MIN_BET_AMOUNT != null &&
    Number.isFinite(limits.MIN_BET_AMOUNT)
  ) {
    parts.push(`Min stake ${limits.MIN_BET_AMOUNT} ETB`);
  }
  if (
    limits?.MAX_BET_AMOUNT != null &&
    Number.isFinite(limits.MAX_BET_AMOUNT)
  ) {
    parts.push(`Max stake ${limits.MAX_BET_AMOUNT} ETB`);
  }
  if (
    limits?.MAX_WINNING_AMOUNT != null &&
    Number.isFinite(limits.MAX_WINNING_AMOUNT)
  ) {
    parts.push(`Max possible win ${limits.MAX_WINNING_AMOUNT} ETB`);
  }
  return parts;
}

export function clampStakeToLimits(limits, rawNum) {
  let n =
    typeof rawNum === "number" && Number.isFinite(rawNum)
      ? Math.max(0, rawNum)
      : 0;
  const minB = limits?.MIN_BET_AMOUNT;
  const maxB = limits?.MAX_BET_AMOUNT;
  if (minB != null && Number.isFinite(minB)) n = Math.max(minB, n);
  if (maxB != null && Number.isFinite(maxB)) n = Math.min(maxB, n);
  return n;
}

export function coerceStakeDisplayToLimits(prevInput, limits) {
  if (prevInput === "") return "";
  const n = Number(prevInput);
  if (!Number.isFinite(n)) return String(prevInput);
  return String(clampStakeToLimits(limits, Math.max(0, n)));
}
