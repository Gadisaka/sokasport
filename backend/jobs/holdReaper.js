/**
 * Held-ticket reaper — crash-recovery safety net for the live bet-acceptance delay.
 */
import { prisma } from "../Config/db.js";
import { refundHeldTicket } from "../services/heldTicketService.js";

const DEFAULT_BATCH = Number(process.env.HOLD_REAPER_BATCH || 100);
const REAPER_DEADLINE_MS = Number(
  process.env.HELD_TICKET_REAPER_DEADLINE_MS || 15000,
);
const ACCEPTANCE_DELAY_MS = Number(process.env.LIVE_ACCEPTANCE_DELAY_MS || 2500);
if (REAPER_DEADLINE_MS <= ACCEPTANCE_DELAY_MS) {
  console.warn(
    `[holdReaper] HELD_TICKET_REAPER_DEADLINE_MS=${REAPER_DEADLINE_MS}ms is not above ` +
      `LIVE_ACCEPTANCE_DELAY_MS=${ACCEPTANCE_DELAY_MS}ms — in-flight holds may be reaped early.`,
  );
}

export async function runHoldReaper({
  db = prisma,
  refund = refundHeldTicket,
  now = Date.now(),
} = {}) {
  const cutoff = new Date(now - REAPER_DEADLINE_MS);

  const stale = await db.ticket.findMany({
    where: { status: "HELD", created_at: { lt: cutoff } },
    select: { id: true },
    take: DEFAULT_BATCH,
    orderBy: { created_at: "asc" },
  });

  let refunded = 0;
  let skipped = 0;
  for (const t of stale) {
    try {
      const result = await refund(t.id);
      if (result?.canceled) {
        refunded++;
        console.warn(
          `[holdReaper] refunded abandoned HELD ticket=${t.id} ` +
            `reason=${result.reason} amount=${result.refunded ?? 0}`,
        );
      } else {
        skipped++;
      }
    } catch (err) {
      skipped++;
      console.error(
        `[holdReaper] failed ticket=${t.id}:`,
        err?.message || err,
      );
    }
  }

  if (stale.length > 0) {
    console.log(
      `[holdReaper] scanned=${stale.length} refunded=${refunded} skipped=${skipped}`,
    );
  }
  return { scanned: stale.length, refunded, skipped };
}

export default runHoldReaper;
