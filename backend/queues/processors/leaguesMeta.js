import syncLeagues from "../../jobs/syncLeagues.js";

/**
 * Processor for the `sync-leagues-meta` queue.
 *
 * In Phase 2 this is just the existing `syncLeagues` (with its TARGET_LEAGUES
 * whitelist). Phase 3 demotes the underlying job to a weekly metadata-only
 * refresh and drops the whitelist.
 */
export async function processLeaguesMeta(job) {
  await syncLeagues();
  return { job: job.name };
}
