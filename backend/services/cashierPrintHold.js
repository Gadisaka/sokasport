/**
 * Cashier print-hold ledger: take shop float before the thermal printer,
 * release it only if local print fails.
 *
 * Hold BET reference stays `ticket-print:{ticketId}` so dashboard sold stats,
 * cancel refunds, settlement, and cashback keep working.
 *
 * Abort frees that unique ref by renaming the BET to
 * `print-aborted:{ticketId}:{timestamp}` and crediting
 * `print-abort-refund:{ticketId}:{timestamp}` (DEPOSIT, non-withdrawable).
 * Abort rows do not use the `ticket-print:` prefix.
 *
 * @module services/cashierPrintHold
 */

import {
  creditWallet,
  debitWallet,
  restoreWallet,
  walletSnapshot,
} from "../lib/walletBalance.js";
import { toMoney } from "../lib/moneyDecimal.js";

export function cashierPrintBetReference(ticketId) {
  return `ticket-print:${ticketId}`;
}

export function cashierPrintAbortBetReference(ticketId, timestamp) {
  return `print-aborted:${ticketId}:${timestamp}`;
}

export function cashierPrintAbortRefundReference(ticketId, timestamp) {
  return `print-abort-refund:${ticketId}:${timestamp}`;
}

export async function findCashierPrintBet(tx, ticketId) {
  return tx.transaction.findFirst({
    where: {
      type: "BET",
      reference: cashierPrintBetReference(ticketId),
    },
    select: { id: true, wallet_id: true, amount: true },
  });
}

/**
 * Debit cashier float for an OPEN ticket (or no-op if already held).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{
 *   ticket: { id: string, stake: number, status?: string, cashier_id?: string|null, receipt_number?: string|null, branch_name?: string|null, branch_location?: string|null },
 *   cashier: { id: string, wallet_id: string, branch_name?: string|null, branch_location?: string|null },
 *   reserveReceiptNumber: (client: import("@prisma/client").Prisma.TransactionClient) => Promise<string>,
 * }} args
 */
export async function holdCashierPrintInTx(
  tx,
  { ticket, cashier, reserveReceiptNumber },
) {
  if (!ticket?.id) throw new Error("TICKET_REQUIRED");
  if (!cashier?.wallet_id) throw new Error("CASHIER_WALLET_NOT_FOUND");

  const existing = await findCashierPrintBet(tx, ticket.id);
  if (existing) {
    if (existing.wallet_id !== cashier.wallet_id) {
      throw Object.assign(new Error("ACCESS_DENIED"), { statusCode: 403 });
    }
    const withReceipt = await ensureReceiptAndCashier(tx, {
      ticket,
      cashier,
      reserveReceiptNumber,
    });
    const wallet = await tx.wallet.findUnique({
      where: { id: cashier.wallet_id },
    });
    return {
      alreadyHeld: true,
      deductedAmount: 0,
      balanceAfter: toMoney(wallet?.balance || 0),
      ticket: withReceipt,
    };
  }

  const claimed = await claimTicketForCashier(tx, { ticket, cashier });

  const wallet = await tx.wallet.findUnique({
    where: { id: cashier.wallet_id },
  });
  if (!wallet) throw new Error("CASHIER_WALLET_NOT_FOUND");

  const stakeAmount = toMoney(claimed.stake);
  const beforeSnap = walletSnapshot(wallet);
  const debited = await debitWallet(tx, wallet, stakeAmount, {
    fromWithdrawable: false,
  });

  try {
    await tx.transaction.create({
      data: {
        wallet_id: wallet.id,
        type: "BET",
        amount: stakeAmount,
        balance_before: debited.balanceBefore,
        balance_after: debited.balanceAfter,
        reference: cashierPrintBetReference(ticket.id),
      },
    });
  } catch (err) {
    if (err?.code === "P2002") {
      await restoreWallet(tx, wallet, beforeSnap);
      const raced = await findCashierPrintBet(tx, ticket.id);
      if (raced) {
        const liveWallet = await tx.wallet.findUnique({
          where: { id: cashier.wallet_id },
        });
        const withReceipt = await ensureReceiptAndCashier(tx, {
          ticket: claimed,
          cashier,
          reserveReceiptNumber,
        });
        return {
          alreadyHeld: true,
          deductedAmount: 0,
          balanceAfter: toMoney(liveWallet?.balance || 0),
          ticket: withReceipt,
        };
      }
    }
    throw err;
  }

  const withReceipt = await ensureReceiptAndCashier(tx, {
    ticket: claimed,
    cashier,
    reserveReceiptNumber,
  });

  return {
    alreadyHeld: false,
    deductedAmount: stakeAmount,
    balanceAfter: debited.balanceAfter,
    ticket: withReceipt,
  };
}

/**
 * Release a live print hold: rename the BET (frees `ticket-print:{id}`) and
 * credit the shop. Caller must run this inside `$transaction` + wallet lock.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ ticketId: string, now?: number }} args
 */
export async function abortCashierPrintHoldInTx(
  tx,
  { ticketId, now = Date.now() },
) {
  const printTx = await findCashierPrintBet(tx, ticketId);
  if (!printTx) {
    return { aborted: false, refunded: 0, reason: "not_held", balanceAfter: null };
  }

  const amount = toMoney(printTx.amount);
  const abortedRef = cashierPrintAbortBetReference(ticketId, now);
  const refundRef = cashierPrintAbortRefundReference(ticketId, now);

  await tx.transaction.update({
    where: { id: printTx.id },
    data: { reference: abortedRef },
  });

  if (amount <= 0 || !printTx.wallet_id) {
    return { aborted: true, refunded: 0, reason: "no_wallet_or_amount", balanceAfter: null };
  }

  const wallet = await tx.wallet.findUnique({
    where: { id: printTx.wallet_id },
  });
  if (!wallet) {
    return { aborted: true, refunded: 0, reason: "no_wallet", balanceAfter: null };
  }

  const beforeSnap = walletSnapshot(wallet);
  const credited = await creditWallet(tx, wallet, amount, {
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
      await restoreWallet(tx, wallet, beforeSnap);
      return {
        aborted: true,
        refunded: 0,
        reason: "already_refunded",
        balanceAfter: toMoney(wallet.balance),
      };
    }
    throw err;
  }

  return {
    aborted: true,
    refunded: amount,
    reason: "refunded",
    balanceAfter: credited.balanceAfter,
  };
}

async function claimTicketForCashier(tx, { ticket, cashier }) {
  const live = await tx.ticket.findUnique({ where: { id: ticket.id } });
  if (!live || live.status !== "OPEN") {
    throw Object.assign(new Error("STATUS_CONFLICT"), { statusCode: 409 });
  }
  if (live.cashier_id && live.cashier_id !== cashier.id) {
    throw Object.assign(new Error("ACCESS_DENIED"), { statusCode: 403 });
  }

  return tx.ticket.update({
    where: { id: live.id },
    data: {
      cashier_id: cashier.id,
      branch_name: live.branch_name || cashier.branch_name,
      branch_location: live.branch_location || cashier.branch_location,
    },
  });
}

async function ensureReceiptAndCashier(
  tx,
  { ticket, cashier, reserveReceiptNumber },
) {
  const data = {};
  if (!ticket.cashier_id) {
    data.cashier_id = cashier.id;
    data.branch_name = ticket.branch_name || cashier.branch_name;
    data.branch_location = ticket.branch_location || cashier.branch_location;
  }
  if (!ticket.receipt_number) {
    data.receipt_number = await reserveReceiptNumber(tx);
  }
  if (Object.keys(data).length === 0) return ticket;
  return tx.ticket.update({
    where: { id: ticket.id },
    data,
  });
}
