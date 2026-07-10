import { Queue, QueueEvents } from "bullmq";
import { getQueueConnection, getQueuePrefix } from "./connection.js";

/**
 * Queue catalogue. One BullMQ queue per long-running job family so a slow
 * odds run can never starve the live poller. Concurrency=1 per queue is
 * configured at the worker level (see worker.js); jobs within a queue are
 * therefore strictly serialized.
 */

export const QUEUE_NAMES = {
  FIXTURES_BULK: "sync-fixtures-bulk",
  ODDS: "sync-odds",
  LIVE: "sync-live",
  LEAGUES_META: "sync-leagues-meta",
  SETTLEMENT_RETRY: "settlement-retry",
  HOLD_REAPER: "hold-reaper",
};

export const REPEATABLE_JOB_NAMES = {
  FIXTURES_NEAR: "fixtures:near",
  FIXTURES_FUTURE: "fixtures:future",
  FIXTURES_LOOKBACK: "fixtures:lookback",
  ODDS_TICK: "odds:tick",
  LIVE_TICK: "live:tick",
  LEAGUES_META: "leagues:meta",
  SETTLEMENT_RETRY: "settlement:retry",
  HOLD_REAPER_TICK: "hold-reaper:tick",
};

const DEFAULT_JOB_OPTIONS = {
  // Failed jobs retry with backoff – upstream API blips shouldn't drop a tick.
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  // Trim history aggressively – we don't need a 30-day audit trail of every poll.
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 200 },
};

const queues = new Map();
const queueEvents = new Map();

function buildQueue(name) {
  return new Queue(name, {
    connection: getQueueConnection(),
    prefix: getQueuePrefix(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

export function getQueue(name) {
  if (!queues.has(name)) queues.set(name, buildQueue(name));
  return queues.get(name);
}

export function getAllQueues() {
  return Object.values(QUEUE_NAMES).map((name) => getQueue(name));
}

export function getQueueEvents(name) {
  if (!queueEvents.has(name)) {
    queueEvents.set(
      name,
      new QueueEvents(name, {
        connection: getQueueConnection(),
        prefix: getQueuePrefix(),
      }),
    );
  }
  return queueEvents.get(name);
}

export async function closeQueues() {
  const tasks = [];
  for (const q of queues.values()) tasks.push(q.close().catch(() => {}));
  for (const qe of queueEvents.values()) tasks.push(qe.close().catch(() => {}));
  await Promise.all(tasks);
  queues.clear();
  queueEvents.clear();
}
