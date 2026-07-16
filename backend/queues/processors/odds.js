import syncOdds from "../../jobs/syncOdds.js";

/**
 * Processor for the `sync-odds` queue.
 *
 * Passes job.data to syncOdds so repeatable ticks use defaults while
 * post-fixture-bulk backfills can specify horizonDays, maxFixtures, mode.
 */
export async function processOdds(job) {
  const result = await syncOdds(job.data ?? {});
  return { job: job.name, ...result };
}
