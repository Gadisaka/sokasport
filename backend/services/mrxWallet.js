/**
 * MRX Instant Games wallet bridge operations.
 *
 * Idempotent via `Transaction.reference @unique`. Uses `walletBalance.js`:
 *   GAME_FEE     -> debitWallet (stake) + BET ledger
 *   GAME_WINNING -> creditWallet(withdrawable: true) + PAYOUT ledger
 *
 * References:
 *   fee -> mrx:fee:{id}
 *   win -> mrx:win:{id}
 *
 * @module services/mrxWallet
 */
import { prisma } from "../Config/db.js";
import { feeRef, winRef } from "../lib/mrxWalletRefs.js";
import { toMoney } from "../lib/moneyDecimal.js";
import { normalizeEthiopiaPhone } from "../lib/phone.js";
import {
  creditWallet,
  debitWallet,
  restoreWallet,
  walletSnapshot,
} from "../lib/walletBalance.js";

export { feeRef, winRef };

function isUniqueConstraintError(err) {
  return err?.code === "P2002";
}

/**
 * @typedef {Object} MrxWalletResult
 * @property {"ok"|"insufficient_funds"|"user_not_found"|"no_wallet"|"duplicate"|"invalid_amount"} status
 * @property {number} [balance]
 */

/**
 * Resolve PLAYER user + wallet by any accepted Ethiopian phone format.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} phone
 */
async function findPlayerByPhone(tx, phone) {
  const canonical = normalizeEthiopiaPhone(phone);
  if (!canonical) return null;

  const user = await tx.user.findFirst({
    where: {
      phone: canonical,
      status: true,
      role: { name: "PLAYER" },
    },
    select: {
      id: true,
      wallets: {
        where: { wallet_type: "PLAYER" },
        take: 1,
      },
    },
  });
  if (!user) return null;
  return { userId: user.id, wallet: user.wallets[0] ?? null };
}

/**
 * Debit a game stake (GAME_FEE).
 *
 * @param {string} phone
 * @param {number} amount
 * @param {string} referenceId Idempotency key (caller-provided or generated)
 * @returns {Promise<MrxWalletResult>}
 */
export async function debitGameFee(phone, amount, referenceId) {
  const reference = feeRef(referenceId);
  const stake = toMoney(amount);
  if (!Number.isFinite(stake) || stake <= 0) {
    return { status: "invalid_amount" };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findFirst({
      where: { reference },
      select: { balance_after: true },
    });
    if (existing) {
      return { status: "duplicate", balance: Number(existing.balance_after) };
    }

    const found = await findPlayerByPhone(tx, phone);
    if (!found) return { status: "user_not_found" };
    if (!found.wallet) return { status: "no_wallet" };

    // Re-load full wallet so wallet_type + withdrawable are never partial.
    const wallet = await tx.wallet.findUnique({ where: { id: found.wallet.id } });
    if (!wallet || wallet.wallet_type !== "PLAYER") {
      return { status: "no_wallet" };
    }

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
 * Credit a game win (GAME_WINNING) — increases withdrawable.
 *
 * @param {string} phone
 * @param {number} amount
 * @param {string} referenceId
 * @returns {Promise<MrxWalletResult>}
 */
export async function creditGameWinning(phone, amount, referenceId) {
  const reference = winRef(referenceId);
  const credit = toMoney(amount);
  if (!Number.isFinite(credit) || credit <= 0) {
    return { status: "invalid_amount" };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findFirst({
      where: { reference },
      select: { balance_after: true },
    });
    if (existing) {
      return { status: "duplicate", balance: Number(existing.balance_after) };
    }

    const found = await findPlayerByPhone(tx, phone);
    if (!found) return { status: "user_not_found" };
    if (!found.wallet) return { status: "no_wallet" };

    // Re-load full wallet so wallet_type + withdrawable are never partial.
    const wallet = await tx.wallet.findUnique({ where: { id: found.wallet.id } });
    if (!wallet || wallet.wallet_type !== "PLAYER") {
      return { status: "no_wallet" };
    }

    const beforeSnap = walletSnapshot(wallet);
    const credited = await creditWallet(tx, wallet, credit, {
      withdrawable: true,
    });

    // Game wins must unlock withdrawable; catch silent accounting failures.
    const expectedWithdrawable = toMoney(
      (beforeSnap.withdrawable ?? 0) + credit,
    );
    if (credited.withdrawableAfter < Math.min(expectedWithdrawable, credited.balanceAfter)) {
      throw new Error("MRX_WIN_WITHDRAWABLE_NOT_APPLIED");
    }

    try {
      await tx.transaction.create({
        data: {
          wallet_id: wallet.id,
          type: "PAYOUT",
          amount: credit,
          balance_before: credited.balanceBefore,
          balance_after: credited.balanceAfter,
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

    return { status: "ok", balance: credited.balanceAfter };
  });
}
