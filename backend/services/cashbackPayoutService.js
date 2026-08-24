/**
 * Claim-time cashback quotes for cashier-printed LOST tickets.
 *
 * Online tickets continue to receive wallet credit at settlement via
 * `creditCashbackOnLostTicketInTx`. Printed slips have no player wallet, so
 * cashiers pay cashback at the counter after eligibility is re-checked with
 * `now = claim time` (maxHours measured from placement → scan).
 *
 * @module services/cashbackPayoutService
 */
import {
  cashbackPayoutRef,
  evaluateCashback,
  getActiveBonus,
  loadCashbackContext,
} from "../lib/bonusEngine.js";

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {string} ticketId
 */
export async function hasCashierPrintTx(db, ticketId) {
  const row = await db.transaction.findFirst({
    where: { type: "BET", reference: `ticket-print:${ticketId}` },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {string} ticketId
 */
export async function hasCashbackPayoutTx(db, ticketId) {
  const row = await db.transaction.findFirst({
    where: { reference: cashbackPayoutRef(ticketId) },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Build a cashier cashback quote for a printed LOST ticket.
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {import("@prisma/client").Ticket} ticket
 * @param {{ now?: Date, requirePrinted?: boolean }} [opts]
 * @returns {Promise<{
 *   allowed: boolean,
 *   amount: number,
 *   result: number | null,
 *   tier: object | null,
 *   profileKey: string | null,
 *   reasonCode: string,
 * }>}
 */
export async function buildCashbackQuote(db, ticket, opts = {}) {
  const now = opts.now ?? new Date();
  const requirePrinted = opts.requirePrinted !== false;

  const deny = (reasonCode) => ({
    allowed: false,
    amount: 0,
    result: null,
    tier: null,
    profileKey: null,
    reasonCode,
  });

  if (!ticket) return deny("ticket_not_found");
  if (ticket.status === "CASHBACK_PAID") return deny("already_paid");
  if (ticket.status !== "LOST") return deny("ticket_not_lost");

  const printed = await hasCashierPrintTx(db, ticket.id);
  if (requirePrinted && !printed) return deny("not_cashier_ticket");

  if (await hasCashbackPayoutTx(db, ticket.id)) {
    return deny("already_paid");
  }

  const bonus = await getActiveBonus(db, "CASHBACK");
  if (!bonus) return deny("inactive");

  const { selections, fixtureStatuses, matchStatuses } =
    await loadCashbackContext(db, ticket.id);

  const ev = evaluateCashback({
    ticket,
    selections,
    fixtureStatuses,
    matchStatuses,
    bonus,
    now,
    isOnline: !printed,
  });

  if (!ev.eligible) {
    return {
      allowed: false,
      amount: 0,
      result: ev.result,
      tier: ev.tier,
      profileKey: ev.profileKey ?? null,
      reasonCode: ev.reason || "not_eligible",
    };
  }

  return {
    allowed: true,
    amount: ev.amount,
    result: ev.result,
    tier: ev.tier,
    profileKey: ev.profileKey ?? null,
    reasonCode: "eligible",
  };
}
