/**
 * Betting / wallet limits persisted in `settings` (admins configure via Settings UI).
 */

import { roundMoney } from "./bonusEngine.js";

export const BETTING_LIMIT_KEYS = [
  "MIN_BET_AMOUNT",
  "MAX_BET_AMOUNT",
  "MAX_WINNING_AMOUNT",
  "MIN_DEPOSIT",
  "MAX_DEPOSIT",
  "MIN_WITHDRAW",
  "MAX_WITHDRAW",
];

/**
 * Resolved numeric limits; `null` means admin left the field unset.
 * @param {import("@prisma/client").PrismaClient} prismaClient
 */
export async function resolveBettingLimits(prismaClient) {
  const rows = await prismaClient.setting.findMany({
    where: { key: { in: BETTING_LIMIT_KEYS } },
    select: { key: true, value: true },
  });

  const map = {};
  for (const key of BETTING_LIMIT_KEYS) {
    const row = rows.find((r) => r.key === key);
    if (!row?.value) {
      map[key] = null;
      continue;
    }
    const n = Number(row.value);
    map[key] = Number.isFinite(n) ? n : null;
  }
  return map;
}

/**
 * Clamp gross possible win to admin `MAX_WINNING_AMOUNT` (financial settings).
 * @param {Record<string, number|null>} limits
 * @param {number} grossPotentialWin
 * @returns {number}
 */
export function capGrossPotentialWin(limits, grossPotentialWin) {
  const maxWin = limits?.MAX_WINNING_AMOUNT;
  const g = roundMoney(Number(grossPotentialWin));
  if (maxWin == null || !Number.isFinite(maxWin)) return g;
  return Math.min(g, roundMoney(maxWin));
}

/**
 * @param {Record<string, number|null>} limits
 * @param {number} stake
 * @param {number} [_potentialWin] gross — unused; callers may pass capped gross for API symmetry
 * @returns {string|null} user-facing rejection message when invalid
 */
export function getStakeAndPotentialWinViolation(limits, stake, _potentialWin) {
  const minBet = limits.MIN_BET_AMOUNT;
  const maxBet = limits.MAX_BET_AMOUNT;

  if (
    minBet != null &&
    Number.isFinite(minBet) &&
    stake < minBet
  ) {
    return `Minimum stake is ${minBet} ETB`;
  }
  if (
    maxBet != null &&
    Number.isFinite(maxBet) &&
    stake > maxBet
  ) {
    return `Maximum stake is ${maxBet} ETB`;
  }

  return null;
}

export function getWithdrawAmountViolation(limits, amount) {
  const minW = limits.MIN_WITHDRAW;
  const maxW = limits.MAX_WITHDRAW;

  if (
    minW != null &&
    Number.isFinite(minW) &&
    amount < minW
  ) {
    return `Minimum withdrawal is ${minW} ETB`;
  }
  if (
    maxW != null &&
    Number.isFinite(maxW) &&
    amount > maxW
  ) {
    return `Maximum withdrawal is ${maxW} ETB`;
  }

  return null;
}

/** Mirrors shop / online deposit boundaries (MIN_DEPOSIT / MAX_DEPOSIT settings). */
export function getDepositAmountViolation(limits, amount) {
  const minD = limits.MIN_DEPOSIT;
  const maxD = limits.MAX_DEPOSIT;

  if (
    minD != null &&
    Number.isFinite(minD) &&
    amount < minD
  ) {
    return `Minimum deposit is ${minD} ETB`;
  }
  if (
    maxD != null &&
    Number.isFinite(maxD) &&
    amount > maxD
  ) {
    return `Maximum deposit is ${maxD} ETB`;
  }

  return null;
}
