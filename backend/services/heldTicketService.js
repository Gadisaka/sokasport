import { prisma } from "../Config/db.js";
import { withWalletLock } from "../lib/walletLock.js";
import {
  creditWallet,
  restoreWallet,
  walletSnapshot,
} from "../lib/walletBalance.js";

/**
 * Finalize helpers for HELD live-bet tickets (the bet-acceptance delay).
 * Shared by the placement controller's hold path and the hold reaper.
 */

export async function commitHeldTicket(ticketId, { db = prisma } = {}) {
  const { count } = await db.ticket.updateMany({
    where: { id: ticketId, status: "HELD" },
    data: { status: "OPEN" },
  });
  return count === 1;
}

export async function refundHeldTicket(
  ticketId,
  { db = prisma, lock = withWalletLock } = {},
) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, user_id: true, stake: true },
  });
  if (!ticket || ticket.status !== "HELD") {
    return { canceled: false, refunded: 0, reason: "not_held" };
  }

  if (!ticket.user_id) {
    const { count } = await db.ticket.updateMany({
      where: { id: ticketId, status: "HELD" },
      data: { status: "CANCELED" },
    });
    return { canceled: count === 1, refunded: 0, reason: "no_user" };
  }

  const wallet = await db.wallet.findFirst({
    where: { user_id: ticket.user_id, wallet_type: "PLAYER" },
    select: { id: true },
  });
  if (!wallet) {
    const { count } = await db.ticket.updateMany({
      where: { id: ticketId, status: "HELD" },
      data: { status: "CANCELED" },
    });
    return { canceled: count === 1, refunded: 0, reason: "no_wallet" };
  }

  return lock(wallet.id, {}, async () =>
    db.$transaction(async (tx) => {
      const { count } = await tx.ticket.updateMany({
        where: { id: ticketId, status: "HELD" },
        data: { status: "CANCELED" },
      });
      if (count !== 1) {
        return { canceled: false, refunded: 0, reason: "already_finalized" };
      }

      const amount = Number(ticket.stake) || 0;
      if (amount <= 0) {
        return { canceled: true, refunded: 0, reason: "non_positive_stake" };
      }

      const refundRef = `hold-refund:${ticketId}`;
      const existing = await tx.transaction.findFirst({
        where: { reference: refundRef },
        select: { id: true },
      });
      if (existing) {
        return { canceled: true, refunded: 0, reason: "already_refunded" };
      }

      const live = await tx.wallet.findUnique({
        where: { id: wallet.id },
      });
      if (!live) {
        return { canceled: true, refunded: 0, reason: "no_wallet" };
      }
      const beforeSnap = walletSnapshot(live);
      const credited = await creditWallet(tx, live, amount, {
        withdrawable: false,
      });
      try {
        await tx.transaction.create({
          data: {
            wallet_id: wallet.id,
            type: "DEPOSIT",
            amount,
            balance_before: credited.balanceBefore,
            balance_after: credited.balanceAfter,
            reference: refundRef,
          },
        });
      } catch (err) {
        if (err?.code === "P2002") {
          await restoreWallet(tx, live, beforeSnap);
          return { canceled: true, refunded: 0, reason: "already_refunded_race" };
        }
        throw err;
      }
      return { canceled: true, refunded: amount, reason: "refunded" };
    }),
  );
}
