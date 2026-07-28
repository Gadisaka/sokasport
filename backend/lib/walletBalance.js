/**
 * Player wallet balance / withdrawable accounting.
 *
 * Rules:
 * - Deposit / bonus / cancel-refund: credit balance only (withdrawable unchanged)
 * - Payout / cashout (sportsbook, MRX wins, InOut wins): credit both balance and withdrawable
 * - Bet stake (sportsbook / MRX fee / InOut bet): debit balance; consume non-withdrawable first, then withdrawable
 * - InOut rollback: credit balance only (stake refund, not withdrawable)
 * - Withdraw: debit both; requires withdrawable >= amount
 * - Invariant (PLAYER): 0 <= withdrawable <= balance
 *
 * CASHIER wallets only update `balance`; `withdrawable` is left untouched.
 *
 * @module lib/walletBalance
 */

import { toMoney, d } from "./moneyDecimal.js";

/**
 * @param {number} balance
 * @param {number} withdrawable
 */
function snapPlayer(balance, withdrawable) {
  const b = toMoney(balance);
  let w = toMoney(withdrawable);
  if (w < 0) w = 0;
  if (w > b) w = b;
  return { balance: b, withdrawable: w };
}

function isPlayer(wallet) {
  return wallet?.wallet_type === "PLAYER";
}

/**
 * Snapshot used by restoreWallet after a failed unique-constraint race.
 * @param {{ balance: number, withdrawable?: number|null }} wallet
 */
export function walletSnapshot(wallet) {
  return {
    balance: toMoney(wallet.balance),
    withdrawable: toMoney(wallet.withdrawable ?? 0),
  };
}

/**
 * Credit a wallet inside an existing Prisma transaction.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ id: string, balance: number, withdrawable?: number|null, wallet_type: string }} wallet
 * @param {number} amount
 * @param {{ withdrawable?: boolean }} [opts] — when true (and PLAYER), also increases withdrawable
 * @returns {Promise<{ balanceBefore: number, balanceAfter: number, withdrawableBefore: number, withdrawableAfter: number }>}
 */
export async function creditWallet(tx, wallet, amount, { withdrawable = false } = {}) {
  const a = toMoney(amount);
  if (!Number.isFinite(a) || a <= 0) {
    throw new Error("INVALID_AMOUNT");
  }

  const balanceBefore = toMoney(wallet.balance);
  const withdrawableBefore = toMoney(wallet.withdrawable ?? 0);
  const balanceAfter = toMoney(d(balanceBefore).add(a));

  // Guard: a withdrawable credit with a missing wallet_type would silently
  // skip updating `withdrawable` (treated as non-PLAYER). Fail loud instead.
  if (withdrawable && wallet?.wallet_type == null) {
    throw new Error("WALLET_TYPE_MISSING");
  }

  if (!isPlayer(wallet)) {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: balanceAfter },
    });
    return {
      balanceBefore,
      balanceAfter,
      withdrawableBefore,
      withdrawableAfter: withdrawableBefore,
    };
  }

  let withdrawableAfter = withdrawableBefore;
  if (withdrawable) {
    withdrawableAfter = toMoney(d(withdrawableBefore).add(a));
  }
  const snapped = snapPlayer(balanceAfter, withdrawableAfter);

  await tx.wallet.update({
    where: { id: wallet.id },
    data: {
      balance: snapped.balance,
      withdrawable: snapped.withdrawable,
    },
  });

  return {
    balanceBefore,
    balanceAfter: snapped.balance,
    withdrawableBefore,
    withdrawableAfter: snapped.withdrawable,
  };
}

/**
 * Debit a wallet inside an existing Prisma transaction.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ id: string, balance: number, withdrawable?: number|null, wallet_type: string }} wallet
 * @param {number} amount
 * @param {{ fromWithdrawable?: boolean }} [opts]
 *   - fromWithdrawable true: withdrawal — requires withdrawable >= amount
 *   - fromWithdrawable false: stake — consume non-withdrawable first
 * @returns {Promise<{ balanceBefore: number, balanceAfter: number, withdrawableBefore: number, withdrawableAfter: number }>}
 */
export async function debitWallet(tx, wallet, amount, { fromWithdrawable = false } = {}) {
  const a = toMoney(amount);
  if (!Number.isFinite(a) || a <= 0) {
    throw new Error("INVALID_AMOUNT");
  }

  const balanceBefore = toMoney(wallet.balance);
  const withdrawableBefore = toMoney(wallet.withdrawable ?? 0);

  if (balanceBefore < a) {
    throw new Error("INSUFFICIENT_BALANCE");
  }

  if (!isPlayer(wallet)) {
    const balanceAfter = toMoney(d(balanceBefore).sub(a));
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: balanceAfter },
    });
    return {
      balanceBefore,
      balanceAfter,
      withdrawableBefore,
      withdrawableAfter: withdrawableBefore,
    };
  }

  let withdrawableAfter = withdrawableBefore;

  if (fromWithdrawable) {
    if (withdrawableBefore < a) {
      throw new Error("INSUFFICIENT_WITHDRAWABLE");
    }
    withdrawableAfter = toMoney(d(withdrawableBefore).sub(a));
  } else {
    // Stake: burn non-withdrawable first, then withdrawable.
    const nonWithdrawable = toMoney(d(balanceBefore).sub(withdrawableBefore));
    const fromNon = Math.min(a, Math.max(0, nonWithdrawable));
    const fromWith = toMoney(d(a).sub(fromNon));
    withdrawableAfter = toMoney(d(withdrawableBefore).sub(fromWith));
  }

  const balanceAfter = toMoney(d(balanceBefore).sub(a));
  const snapped = snapPlayer(balanceAfter, withdrawableAfter);

  await tx.wallet.update({
    where: { id: wallet.id },
    data: {
      balance: snapped.balance,
      withdrawable: snapped.withdrawable,
    },
  });

  return {
    balanceBefore,
    balanceAfter: snapped.balance,
    withdrawableBefore,
    withdrawableAfter: snapped.withdrawable,
  };
}

/**
 * Restore both fields after a P2002 race (ledger insert lost the race).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ id: string, wallet_type: string }} wallet
 * @param {{ balance: number, withdrawable?: number }} before
 */
export async function restoreWallet(tx, wallet, before) {
  const data = { balance: toMoney(before.balance) };
  if (isPlayer(wallet)) {
    data.withdrawable = toMoney(before.withdrawable ?? 0);
  }
  await tx.wallet.update({
    where: { id: wallet.id },
    data,
  });
}
