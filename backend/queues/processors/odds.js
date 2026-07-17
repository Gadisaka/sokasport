import syncOdds from "../../jobs/syncOdds.js";
import syncOddsBulkByDate from "../../jobs/syncOddsBulkByDate.js";
import { REPEATABLE_JOB_NAMES } from "../queues.js";

/**
 * Processor for the `sync-odds` queue.
 *
 * - odds:bulk-by-date → bulk `/odds?date=` sweep across the horizon
 * - everything else (odds:tick, odds:horizon-backfill, …) → per-fixture syncOdds
 */
export async function processOdds(job) {
  if (job.name === REPEATABLE_JOB_NAMES.ODDS_BULK_BY_DATE) {
    const result = await syncOddsBulkByDate(job.data ?? {});
    return { job: job.name, ...result };
  }

  const result = await syncOdds(job.data ?? {});
  return { job: job.name, ...result };
}
