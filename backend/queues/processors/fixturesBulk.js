import { runFixturesBulkByDate } from "../../jobs/syncFixtures.js";
import {
  getOddsHorizonDays,
  syncedUtcDaysSpan,
  getFixturesDaysAhead,
} from "../../Config/ingestionConfig.js";
import { getQueue, QUEUE_NAMES } from "../queues.js";

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
 * Post-ingest odds backfill: enqueues ODDS_BACKFILL_PASSES sequential jobs
 * (default 3) so the full 14-day horizon can be covered even when the number
 * of fixtures without markets exceeds a single job's cap. Each pass uses
 * `missing_first` mode so it naturally picks up whatever the previous pass
 * didn't reach. The `skipNearPriority` flag disables near-window sorting so
 * distant days get equal treatment during backfills.
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
  const oddsHorizonDays = Math.min(spanDays, getOddsHorizonDays());

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

      for (let pass = 1; pass <= BACKFILL_PASSES; pass++) {
        const backfillJobId = `odds-backfill-${label}-p${pass}-${ts}`;
        await oddsQueue.add(
          "odds:horizon-backfill",
          {
            horizonDays: oddsHorizonDays,
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
        `[fixturesBulk] enqueued ${BACKFILL_PASSES} odds backfill passes (horizon=${oddsHorizonDays}d, max=${BACKFILL_MAX_FIXTURES}/pass)`,
      );
    } catch (err) {
      console.error(
        "[fixturesBulk] failed to enqueue odds backfill:",
        err.message,
      );
    }
  }

  return { ...result, label, spanDays, oddsHorizonDays };
}
