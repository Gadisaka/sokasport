/**
 * Client-side UX guard mirroring backend `getStakeAndPotentialWinViolation`
 * (backend/lib/bettingLimits.js). Gross win capping uses `capGrossPotentialWin`
 * (mirrors backend). Keep messages aligned when changing either.
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

export function stakeAndPotentialWinViolation(limits, stake, _potentialWin) {
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

/** Mirrors backend `getDepositAmountViolation`. */
export function depositAmountViolation(limits, amount) {
  const minD = limits?.MIN_DEPOSIT;
  const maxD = limits?.MAX_DEPOSIT;

  if (minD != null && Number.isFinite(minD) && amount < minD) {
    return `Minimum deposit is ${minD} ETB`;
  }
  if (maxD != null && Number.isFinite(maxD) && amount > maxD) {
    return `Maximum deposit is ${maxD} ETB`;
  }
  return null;
}

/** Mirrors backend `getWithdrawAmountViolation`. */
export function withdrawAmountViolation(limits, amount) {
  const minW = limits?.MIN_WITHDRAW;
  const maxW = limits?.MAX_WITHDRAW;

  if (minW != null && Number.isFinite(minW) && amount < minW) {
    return `Minimum withdrawal is ${minW} ETB`;
  }
  if (maxW != null && Number.isFinite(maxW) && amount > maxW) {
    return `Maximum withdrawal is ${maxW} ETB`;
  }
  return null;
}

/** One-line hints for betting slip UX (omit unset limits). */
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

/** Non-negative and MAX_BET_AMOUNT only (no minimum). Used while typing or stepping. */
export function clampStakeToUpperBound(limits, rawNum) {
  let n =
    typeof rawNum === "number" && Number.isFinite(rawNum)
      ? Math.max(0, rawNum)
      : 0;
  const maxB = limits?.MAX_BET_AMOUNT;
  if (maxB != null && Number.isFinite(maxB)) n = Math.min(maxB, n);
  return n;
}

/** Finite non-negative stake from controlled string, or null if empty or unparsable. */
export function parseStakeNumeric(stakeInput) {
  if (stakeInput === "") return null;
  const n = Number(stakeInput);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

/**
 * True when input is empty, unparsable, or outside MIN/MAX stake bounds (input styling only;
 * does not include max possible win).
 */
export function stakeBoundsInvalid(limits, stakeInput) {
  const parsed = parseStakeNumeric(stakeInput);
  if (parsed === null) return true;
  const minB = limits?.MIN_BET_AMOUNT;
  const maxB = limits?.MAX_BET_AMOUNT;
  if (minB != null && Number.isFinite(minB) && parsed < minB) return true;
  if (maxB != null && Number.isFinite(maxB) && parsed > maxB) return true;
  return false;
}

/**
 * Normalize controlled stake input when admin limits arrive or change after first paint.
 * Keeps blank input blank (caller may coerce min on blur if desired).
 */
export function coerceStakeDisplayToLimits(prevInput, limits) {
  if (prevInput === "") return "";
  const n = Number(prevInput);
  if (!Number.isFinite(n)) return String(prevInput);
  return String(clampStakeToLimits(limits, Math.max(0, n)));
}
