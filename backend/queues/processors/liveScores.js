import syncLiveScores from "../../jobs/syncLiveScores.js";

/**
 * Processor for the `sync-live-scores` queue. Wraps the fast score-only poller.
 */
export async function processLiveScores(job) {
  await syncLiveScores();
  return { job: job.name };
}
