/**
 * One-off: set Ticket.paid_at from the matching payout ledger row.
 *
 * Sources (first match wins):
 *   PAID           — PAYOUT ticket:{id} then win-settlement:{id}
 *   CASHBACK_PAID  — BONUS cashback-payout:{id}
 *
 * Tickets that already have paid_at, or have no ledger row, are skipped.
 *
 *   node backend/scripts/backfillTicketPaidAt.js
 */
import { prisma } from "../Config/db.js";
import { paidAtFromLedger } from "../lib/ticketPayday.js";

const BATCH = 200;

async function main() {
  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: ["PAID", "CASHBACK_PAID"] },
      OR: [{ paid_at: null }, { paid_at: { isSet: false } }],
    },
    select: { id: true, status: true },
  });

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < tickets.length; i += BATCH) {
    const chunk = tickets.slice(i, i + BATCH);
    const refs = chunk.flatMap((t) =>
      t.status === "CASHBACK_PAID"
        ? [`cashback-payout:${t.id}`]
        : [`ticket:${t.id}`, `win-settlement:${t.id}`],
    );

    const txs =
      refs.length > 0
        ? await prisma.transaction.findMany({
            where: { reference: { in: refs } },
            select: { reference: true, created_at: true },
          })
        : [];

    for (const ticket of chunk) {
      const paidAt = paidAtFromLedger(ticket.id, ticket.status, txs);
      if (!paidAt) {
        skipped += 1;
        continue;
      }
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { paid_at: paidAt },
      });
      updated += 1;
    }
  }

  console.log(
    `Backfilled paid_at on ${updated} ticket(s); skipped ${skipped} with no ledger row.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
