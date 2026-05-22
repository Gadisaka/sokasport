/**
 * Processor for the `settlement-retry` queue.
 *
 * Wraps `jobs/settlementRetry.runSettlementRetry()` so it can be driven
 * by the BullMQ repeatable scheduler. Any uncaught error propagates so
 * BullMQ records the failure and retries according to the queue's
 * default `attempts` / `backoff` settings.
 *
 * @module queues/processors/settlementRetry
 */
import { runSettlementRetry } from "../../jobs/settlementRetry.js";

export async function processSettlementRetry(job) {
  const result = await runSettlementRetry();
  return { job: job.name, ...result };
}
