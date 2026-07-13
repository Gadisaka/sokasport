/**
 * Reverse wallet debits when a ticket is canceled (player and/or cashier).
 *
 * Player refunds restore balance only (not withdrawable) so deposit→bet→cancel
 * cannot turn deposits into cashable funds.
 *
 * @module services/ticketCancelRefund
 */

import {
  creditWallet,
  restoreWallet,
  walletSnapshot,
} from "../lib/walletBalance.js";

async function creditWalletInTx(tx, { walletId, amount, reference }) {
  const existing = await tx.transaction.findFirst({
    where: { reference },
    select: { id: true },
  });
  if (existing) return null;

  const wallet = await tx.wallet.findUnique({
    where: { id: walletId },
  });
  const numericAmount = Number(amount) || 0;
  if (!wallet || numericAmount <= 0) return null;

  const beforeSnap = walletSnapshot(wallet);
  // Refunds are never withdrawable — prevents deposit/bet/cancel laundering.
  const credited = await creditWallet(tx, wallet, numericAmount, {
    withdrawable: false,
  });

  try {
    await tx.transaction.create({
      data: {
        wallet_id: wallet.id,
        type: "DEPOSIT",
        amount: numericAmount,
        balance_before: credited.balanceBefore,
        balance_after: credited.balanceAfter,
        reference,
      },
    });
  } catch (insertErr) {
    if (insertErr?.code === "P2002") {
      await restoreWallet(tx, wallet, beforeSnap);
      return null;
    }
    throw insertErr;
  }

  return {
    amount: numericAmount,
    walletId: wallet.id,
    walletType: wallet.wallet_type,
    balanceAfter: credited.balanceAfter,
  };
}

/**
 * Refund stake debits for a ticket inside an existing transaction.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ id: string, user_id?: string|null, receipt_number?: string|null, coupon_number?: string, idempotency_key?: string|null, stake?: number }} ticket
 * @returns {Promise<Array<{ kind: string, amount: number, walletId: string, walletType?: string, balanceAfter: number }>>}
 */
export async function refundTicketStakeInTx(tx, ticket) {
  const refunds = [];
  const stake = Number(ticket.stake) || 0;

  if (ticket.user_id) {
    const refundRef = `bet-cancel:${ticket.id}`;
    const existingRefund = await tx.transaction.findFirst({
      where: { reference: refundRef },
      select: { id: true },
    });

    if (!existingRefund) {
      const walletRow = await tx.wallet.findFirst({
        where: { user_id: ticket.user_id, wallet_type: "PLAYER" },
        select: { id: true },
      });

      const refCandidates = [
        ticket.receipt_number ? `ticket:${ticket.receipt_number}` : null,
        ticket.coupon_number ? `ticket:${ticket.coupon_number}` : null,
        ticket.idempotency_key
          ? `idem:${ticket.user_id}:${ticket.idempotency_key}`
          : null,
      ].filter(Boolean);

      const betTx =
        walletRow && refCandidates.length > 0
          ? await tx.transaction.findFirst({
              where: {
                type: "BET",
                wallet_id: walletRow.id,
                reference: { in: refCandidates },
              },
              select: { id: true, wallet_id: true, amount: true },
            })
          : null;

      if (betTx?.wallet_id) {
        const amount = stake || Number(betTx.amount) || 0;
        const wallet = await tx.wallet.findUnique({
          where: { id: betTx.wallet_id },
        });
        if (
          wallet &&
          wallet.wallet_type === "PLAYER" &&
          wallet.user_id === ticket.user_id
        ) {
          const result = await creditWalletInTx(tx, {
            walletId: betTx.wallet_id,
            amount,
            reference: refundRef,
          });
          if (result) refunds.push({ kind: "player", ...result });
        }
      }
    }
  }

  const printReference = `ticket-print:${ticket.id}`;
  const cancelRefundRef = `cancel-refund:${ticket.id}`;
  const printTx = await tx.transaction.findFirst({
    where: { type: "BET", reference: printReference },
    select: { id: true, wallet_id: true, amount: true },
  });

  if (printTx?.wallet_id) {
    const amount = Number(printTx.amount) || stake || 0;
    const result = await creditWalletInTx(tx, {
      walletId: printTx.wallet_id,
      amount,
      reference: cancelRefundRef,
    });
    if (result) refunds.push({ kind: "cashier", ...result });
  }

  return refunds;
}
