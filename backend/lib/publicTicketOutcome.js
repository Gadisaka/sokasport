/**
 * Public check-ticket outcome: Lost / Won (net payout) / Bonus (cashback).
 *
 * @module lib/publicTicketOutcome
 */
import {
  cashbackBonusRef,
  cashbackPayoutRef,
} from "./bonusEngine.js";
import { ticketWinningsTaxBreakdown } from "./winningsTax.js";
import { buildCashbackQuote } from "../services/cashbackPayoutService.js";

const PENDING_STATUSES = new Set(["OPEN", "PRINTED", "HELD"]);
const WON_STATUSES = new Set(["WON", "PAID"]);
const CANCELLED_STATUSES = new Set(["CANCELED", "CASHED_OUT"]);

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {string} ticketId
 * @returns {Promise<number|null>}
 */
export async function findCashbackLedgerAmount(db, ticketId) {
  if (!ticketId) return null;
  const refs = [cashbackBonusRef(ticketId), cashbackPayoutRef(ticketId)];
  for (const reference of refs) {
    const row = await db.transaction.findFirst({
      where: { reference },
      select: { amount: true },
    });
    const amount = Number(row?.amount);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {import("@prisma/client").Ticket} ticket
 * @param {{ now?: Date }} [opts]
 * @returns {Promise<{ outcome: "pending"|"won"|"lost"|"bonus"|"void"|"cancelled", outcomeAmount: number|null }>}
 */
export async function resolvePublicTicketOutcome(db, ticket, opts = {}) {
  const status = String(ticket?.status || "").toUpperCase();

  if (PENDING_STATUSES.has(status)) {
    return { outcome: "pending", outcomeAmount: null };
  }

  if (WON_STATUSES.has(status)) {
    const { netPayout } = ticketWinningsTaxBreakdown(ticket);
    return {
      outcome: "won",
      outcomeAmount: Number.isFinite(netPayout) ? netPayout : null,
    };
  }

  if (status === "VOID") {
    return { outcome: "void", outcomeAmount: null };
  }

  if (CANCELLED_STATUSES.has(status)) {
    return { outcome: "cancelled", outcomeAmount: null };
  }

  if (status === "CASHBACK_PAID") {
    const credited = await findCashbackLedgerAmount(db, ticket.id);
    return { outcome: "bonus", outcomeAmount: credited };
  }

  if (status === "LOST") {
    const credited = await findCashbackLedgerAmount(db, ticket.id);
    if (credited != null) {
      return { outcome: "bonus", outcomeAmount: credited };
    }
    const quote = await buildCashbackQuote(db, ticket, {
      requirePrinted: false,
      now: opts.now,
    });
    if (quote.allowed && Number(quote.amount) > 0) {
      return { outcome: "bonus", outcomeAmount: quote.amount };
    }
    return { outcome: "lost", outcomeAmount: null };
  }

  return { outcome: "pending", outcomeAmount: null };
}
