import syncLiveFixtures from "../../jobs/syncLiveFixtures.js";

/**
 * Processor for the `sync-live` queue. Wraps the existing `syncLiveFixtures`.
 */
export async function processLive(job) {
  await syncLiveFixtures();
  return { job: job.name };
}
