import { runFixturesBulkByDate } from "../../jobs/syncFixtures.js";
import {
  getOddsHorizonDays,
  syncedUtcDaysSpan,
  getFixturesDaysAhead,
  isOddsBulkByDateEnabled,
} from "../../Config/ingestionConfig.js";
import { getQueue, QUEUE_NAMES, REPEATABLE_JOB_NAMES } from "../queues.js";

const BACKFILL_MAX_FIXTURES = Number(
  process.env.ODDS_HORIZON_BACKFILL_MAX || 500,
);

const BACKFILL_PASSES = Math.max(
  1,
  Number(process.env.ODDS_BACKFILL_PASSES) || 3,
);

/**
 * Processor for the `sync-fixtures-bulk` queue.
 *
 * Repeatables:
 *   - fixtures:near — UTC offsets [0 .. NEAR_WINDOW-1] at near cadence
 *   - fixtures:future — full FIXTURES_DAYS_AHEAD span at deep cadence
 *
 * Post-ingest odds:
 *   - When ODDS_BULK_BY_DATE_ENABLED (default): enqueue one odds:bulk-by-date
 *     sweep for the full ODDS_HORIZON_DAYS (not clamped to the fixture span),
 *     so near/today fixture ticks still fill distant days.
 *   - When disabled: legacy ODDS_BACKFILL_PASSES × per-fixture backfill jobs
 *     (still scoped to the just-synced span).
 */
export async function processFixturesBulk(job) {
  const label = job.data?.label ?? "bulk";

  let runOpts;
  if (
    job.data?.startOffset !== undefined ||
    job.data?.endOffset !== undefined
  ) {
    const startOffset = Number(job.data.startOffset) || 0;
    const endOffset =
      job.data.endOffset !== undefined
        ? Number(job.data.endOffset)
        : startOffset;
    runOpts = {
      startOffset,
      endOffset: Number.isFinite(endOffset) ? endOffset : startOffset,
    };
  } else {
    runOpts = {
      daysAhead:
        Number(job.data?.daysAhead) > 0
          ? Math.floor(Number(job.data.daysAhead))
          : getFixturesDaysAhead(),
    };
  }

  const spanDays = syncedUtcDaysSpan(runOpts);
  // Bulk `/odds?date=` must always cover the full odds horizon (default 14d).
  // Do NOT clamp to the fixture sync span — near/today jobs only sync 1–3
  // calendar days, and clamping left days 4–14 never getting odds until the
  // 3h scheduled sweep (if it ran at all).
  const oddsHorizonDays = getOddsHorizonDays();
  // Legacy per-fixture backfill still scopes to the just-synced window so a
  // near tick doesn't try to walk thousands of distant fixtures one-by-one.
  const legacyBackfillHorizonDays = Math.min(spanDays, oddsHorizonDays);

  console.log(
    `[fixturesBulk] starting (${label}, spanDays=${spanDays}, jobId=${job.id})`,
  );

  const result = await runFixturesBulkByDate(runOpts);

  if (
    result.totalUpserts > 0 ||
    label === "bootstrap" ||
    label === "bootstrap-force"
  ) {
    try {
      const oddsQueue = getQueue(QUEUE_NAMES.ODDS);
      const ts = Date.now();

      if (isOddsBulkByDateEnabled()) {
        await oddsQueue.add(
          REPEATABLE_JOB_NAMES.ODDS_BULK_BY_DATE,
          {
            horizonDays: oddsHorizonDays,
            label: `post-fixtures-${label}`,
          },
          {
            jobId: `odds-bulk-by-date-${label}-${ts}`,
            removeOnComplete: 10,
            removeOnFail: 50,
          },
        );
        console.log(
          `[fixturesBulk] enqueued odds:bulk-by-date (horizon=${oddsHorizonDays}d, fixtureSpan=${spanDays}d)`,
        );
      } else {
        for (let pass = 1; pass <= BACKFILL_PASSES; pass++) {
          const backfillJobId = `odds-backfill-${label}-p${pass}-${ts}`;
          await oddsQueue.add(
            "odds:horizon-backfill",
            {
              horizonDays: legacyBackfillHorizonDays,
              maxFixtures: BACKFILL_MAX_FIXTURES,
              mode: "missing_first",
              skipNearPriority: true,
              label: `backfill-${label}-p${pass}`,
            },
            {
              jobId: backfillJobId,
              removeOnComplete: 10,
              removeOnFail: 50,
            },
          );
        }

        console.log(
          `[fixturesBulk] enqueued ${BACKFILL_PASSES} odds backfill passes (horizon=${legacyBackfillHorizonDays}d, max=${BACKFILL_MAX_FIXTURES}/pass)`,
        );
      }
    } catch (err) {
      console.error(
        "[fixturesBulk] failed to enqueue odds backfill:",
        err.message,
      );
    }
  }

  return { ...result, label, spanDays, oddsHorizonDays };
}
