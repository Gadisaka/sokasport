/**
 * Keep PLAYER `withdrawable` aligned with the ledger (MRX / InOut / sportsbook).
 *
 * @module lib/syncWithdrawable
 */
import { toMoney } from "./moneyDecimal.js";
import { replayWithdrawableLedger } from "./withdrawableLedger.js";

/**
 * Recompute withdrawable from ledger and persist if it drifted.
 * Does not change `balance`.
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {{ id: string, balance: number, withdrawable?: number|null, wallet_type?: string }} wallet
 * @returns {Promise<{ balance: number, withdrawable: number, repaired: boolean }>}
 */
export async function syncPlayerWithdrawable(db, wallet) {
  if (!wallet?.id) {
    return { balance: 0, withdrawable: 0, repaired: false };
  }
  if (wallet.wallet_type && wallet.wallet_type !== "PLAYER") {
    const balance = toMoney(wallet.balance);
    return {
      balance,
      withdrawable: toMoney(wallet.withdrawable ?? 0),
      repaired: false,
    };
  }

  const balance = toMoney(wallet.balance);
  const current = toMoney(wallet.withdrawable ?? 0);

  const ledger = await db.transaction.findMany({
    where: { wallet_id: wallet.id },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    select: {
      type: true,
      amount: true,
      reference: true,
      balance_before: true,
      balance_after: true,
    },
  });

  const replayed = replayWithdrawableLedger(ledger);
  const next = toMoney(Math.min(Math.max(0, replayed.withdrawable), balance));

  if (next === current) {
    return { balance, withdrawable: current, repaired: false };
  }

  await db.wallet.update({
    where: { id: wallet.id },
    data: { withdrawable: next },
  });

  return { balance, withdrawable: next, repaired: true };
}

/**
 * Cheap gate: heal when locked funds look wrong (typical bug: balance > 0, withdrawable 0
 * after casino/sportsbook wins).
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {{ id: string, balance: number, withdrawable?: number|null, wallet_type?: string }} wallet
 */
export async function syncPlayerWithdrawableIfNeeded(db, wallet) {
  const balance = toMoney(wallet?.balance ?? 0);
  const current = toMoney(wallet?.withdrawable ?? 0);
  if (balance <= 0) {
    return { balance, withdrawable: current, repaired: false };
  }
  // Always recompute when withdrawable is 0 but player has funds — the reported bug.
  // Also recompute when withdrawable somehow exceeds balance (invariant break).
  if (current === 0 || current > balance) {
    return syncPlayerWithdrawable(db, wallet);
  }
  return { balance, withdrawable: current, repaired: false };
}
