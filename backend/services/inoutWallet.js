/**
 * InOut Games wallet operations (Sokasport).
 *
 * Seamless-wallet money movements for casino play. Idempotent via
 * `Transaction.reference @unique`. Uses `walletBalance.js` so PLAYER
 * withdrawable accounting stays consistent with sportsbook stakes/payouts:
 *   bet      -> debitWallet (stake: non-withdrawable first)
 *   withdraw -> creditWallet(withdrawable: true) for wins; zero = ledger only
 *   rollback -> creditWallet(withdrawable: false) (stake refund)
 *
 * Ledger references:
 *   bet      -> inout:bet:{transactionId}      (type BET,    debit)
 *   withdraw -> inout:withdraw:{transactionId} (type PAYOUT, credit)
 *   rollback -> inout:rollback:{transactionId} (type PAYOUT, credit/refund)
 *
 * @module services/inoutWallet
 */
import { prisma } from "../Config/db.js";
import { toMoney } from "../lib/moneyDecimal.js";
import {
  creditWallet,
  debitWallet,
  restoreWallet,
  walletSnapshot,
} from "../lib/walletBalance.js";

export function betRef(transactionId) {
  return `inout:bet:${transactionId}`;
}
export function withdrawRef(transactionId) {
  return `inout:withdraw:${transactionId}`;
}
export function rollbackRef(transactionId) {
  return `inout:rollback:${transactionId}`;
}

function isUniqueConstraintError(err) {
  return err?.code === "P2002";
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} userId
 */
async function findPlayerWallet(tx, userId) {
  return tx.wallet.findFirst({
    where: { user_id: userId, wallet_type: "PLAYER" },
  });
}

/**
 * @typedef {Object} WalletOpResult
 * @property {"ok"|"insufficient_funds"|"no_wallet"|"duplicate"|"debit_not_found"} status
 * @property {number} [balance]
 */

/**
 * Debit a bet stake from the player wallet.
 *
 * @param {string} userId
 * @param {number} amount Positive stake amount.
 * @param {string} transactionId InOut transaction id (idempotency key).
 * @returns {Promise<WalletOpResult>}
 */
export async function debitForBet(userId, amount, transactionId) {
  const reference = betRef(transactionId);
  const stake = toMoney(amount);
  if (!Number.isFinite(stake) || stake <= 0) {
    return { status: "insufficient_funds" };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findFirst({
      where: { reference },
      select: { balance_after: true },
    });
    if (existing) {
      return { status: "duplicate", balance: Number(existing.balance_after) };
    }

    const wallet = await findPlayerWallet(tx, userId);
    if (!wallet) return { status: "no_wallet" };

    const beforeSnap = walletSnapshot(wallet);
    let debited;
    try {
      debited = await debitWallet(tx, wallet, stake, {
        fromWithdrawable: false,
      });
    } catch (err) {
      if (err?.message === "INSUFFICIENT_BALANCE") {
        return {
          status: "insufficient_funds",
          balance: beforeSnap.balance,
        };
      }
      throw err;
    }

    try {
      await tx.transaction.create({
        data: {
          wallet_id: wallet.id,
          type: "BET",
          amount: stake,
          balance_before: debited.balanceBefore,
          balance_after: debited.balanceAfter,
          reference,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        await restoreWallet(tx, wallet, beforeSnap);
        const dup = await tx.transaction.findFirst({
          where: { reference },
          select: { balance_after: true },
        });
        return {
          status: "duplicate",
          balance: Number(dup?.balance_after ?? beforeSnap.balance),
        };
      }
      throw err;
    }

    return { status: "ok", balance: debited.balanceAfter };
  });
}

/**
 * Credit a payout/refund. `asWithdrawable` true for game wins; false for rollbacks.
 *
 * @param {string} userId
 * @param {number} amount
 * @param {string} reference
 * @param {string} [debitId]
 * @param {boolean} asWithdrawable
 * @returns {Promise<WalletOpResult>}
 */
async function creditPayout(
  userId,
  amount,
  reference,
  debitId,
  asWithdrawable,
) {
  const credit = toMoney(amount);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findFirst({
      where: { reference },
      select: { balance_after: true },
    });
    if (existing) {
      return { status: "duplicate", balance: Number(existing.balance_after) };
    }

    if (debitId) {
      const debit = await tx.transaction.findFirst({
        where: { reference: betRef(debitId) },
        select: { id: true },
      });
      if (!debit) return { status: "debit_not_found" };
    }

    const wallet = await findPlayerWallet(tx, userId);
    if (!wallet) return { status: "no_wallet" };

    const beforeSnap = walletSnapshot(wallet);
    let balanceAfter = beforeSnap.balance;
    let balanceBefore = beforeSnap.balance;

    if (credit > 0) {
      const credited = await creditWallet(tx, wallet, credit, {
        withdrawable: asWithdrawable,
      });
      balanceBefore = credited.balanceBefore;
      balanceAfter = credited.balanceAfter;
    }

    try {
      await tx.transaction.create({
        data: {
          wallet_id: wallet.id,
          type: "PAYOUT",
          amount: credit,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          reference,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        if (credit > 0) {
          await restoreWallet(tx, wallet, beforeSnap);
        }
        const dup = await tx.transaction.findFirst({
          where: { reference },
          select: { balance_after: true },
        });
        return {
          status: "duplicate",
          balance: Number(dup?.balance_after ?? beforeSnap.balance),
        };
      }
      throw err;
    }

    return { status: "ok", balance: balanceAfter };
  });
}

/**
 * Credit the result of a finished game (withdraw webhook).
 * Wins increase withdrawable; zero-result losses only write the ledger row.
 */
export async function creditForWithdraw(userId, result, transactionId, debitId) {
  return creditPayout(
    userId,
    result,
    withdrawRef(transactionId),
    debitId,
    true,
  );
}

/**
 * Refund a bet stake (rollback webhook) — balance only, not withdrawable.
 */
export async function refundForRollback(userId, amount, transactionId, debitId) {
  return creditPayout(
    userId,
    amount,
    rollbackRef(transactionId),
    debitId,
    false,
  );
}
