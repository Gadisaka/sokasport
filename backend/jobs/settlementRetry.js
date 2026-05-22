/**
 * Settlement retry job.
 *
 * Scans for Fixtures that are terminal AND have been settled at least
 * once BUT still carry pending legs (`grading_completed_at IS NULL`),
 * and re-runs `settleFixture` on each. This is the safety net that
 * prevents stuck tickets when:
 *
 *   - upstream data for events/stats was missing on the first pass,
 *   - the V2 engine returned `VOID / missing_required_data` for some
 *     legs because enrichment hadn't caught up yet,
 *   - a module threw and was swallowed as `VOID / module_error:*`
 *     (a follow-up module fix + a retry clears the affected legs).
 *
 * Runs on the `settlement-retry` repeatable queue at a cadence set by
 * `SETTLEMENT_RETRY_INTERVAL_MS` (default 5 minutes).
 *
 * Bounded to `SETTLEMENT_RETRY_BATCH` fixtures per tick to keep the
 * worker healthy and Mongo happy.
 *
 * @module jobs/settlementRetry
 */
import prisma from "../Config/db.js";
import { settleFixture } from "../services/ticketSettlementService.js";
import { enrichFixtureResult } from "./enrichFixtureResult.js";

const DEFAULT_BATCH = Number(process.env.SETTLEMENT_RETRY_BATCH || 50);
// Only retry fixtures whose start_time is within the last N days so we
// don't thrash the DB scanning ancient rows that will never resolve.
const MAX_AGE_DAYS = Number(process.env.SETTLEMENT_RETRY_MAX_AGE_DAYS || 14);

/**
 * @returns {Promise<{ scanned: number, retried: number, completed: number, stillPending: number }>}
 */
export async function runSettlementRetry() {
  const minStart = new Date(
    Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  );

  const stuck = await prisma.fixture.findMany({
    where: {
      start_time: { gte: minStart },
      status: {
        in: ["FT", "AET", "PEN", "AWD", "WO", "CANC", "ABD", "PST"],
      },
      OR: [
        // Partial settlement: settled once but legs still pending.
        { settled_at: { not: null }, grading_completed_at: null },
        // Never settled: first attempt crashed before settled_at was written.
        { settled_at: null },
      ],
    },
    select: { id: true, api_fixture_id: true, status: true },
    take: DEFAULT_BATCH,
    orderBy: { start_time: "asc" },
  });

  let retried = 0;
  let completed = 0;
  let stillPending = 0;
  for (const fx of stuck) {
    try {
      // Try to enrich first — if the only reason the leg was pending
      // was missing events/stats, this unblocks the next settleFixture
      // call. Enrichment is a no-op when the env flag is off or the
      // fixture is already enriched.
      await enrichFixtureResult(fx.id).catch(() => {});
      const result = await settleFixture(fx.id, { force: true });
      retried++;
      if (result?.gradingCompleted) completed++;
      else stillPending++;
    } catch (err) {
      stillPending++;
      console.error(
        `[settlementRetry] failed fixture=${fx.id} api_fixture_id=${fx.api_fixture_id}:`,
        err?.message || err,
      );
    }
  }

  console.log(
    `[settlementRetry] scanned=${stuck.length} retried=${retried} completed=${completed} stillPending=${stillPending}`,
  );
  return {
    scanned: stuck.length,
    retried,
    completed,
    stillPending,
  };
}

export default runSettlementRetry;
