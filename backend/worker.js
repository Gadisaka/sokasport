import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "./Config/db.js";
import { pingRedis } from "./services/cacheService.js";
import {
  getQueueConnection,
  getQueuePrefix,
  closeQueueConnections,
} from "./queues/connection.js";
import { QUEUE_NAMES, closeQueues } from "./queues/queues.js";
import { startScheduler, stopScheduler } from "./queues/scheduler.js";
import { processFixturesBulk } from "./queues/processors/fixturesBulk.js";
import { processOdds } from "./queues/processors/odds.js";
import { processLive } from "./queues/processors/live.js";
import { processLeaguesMeta } from "./queues/processors/leaguesMeta.js";
import { processSettlementRetry } from "./queues/processors/settlementRetry.js";

/**
 * Worker process entry point.
 *
 * Boots Prisma, verifies Redis, then attaches one BullMQ Worker per queue
 * with concurrency=1 so the existing job logic (which assumes a single
 * runner at a time) keeps its invariants. The scheduler registers the
 * repeatable jobs that drive the cadence.
 *
 * Designed to run alongside the Express API (`npm run worker`) and to be
 * deployed as a separate container in production.
 */

const PROCESSOR_REGISTRY = {
  [QUEUE_NAMES.FIXTURES_BULK]: processFixturesBulk,
  [QUEUE_NAMES.ODDS]: processOdds,
  [QUEUE_NAMES.LIVE]: processLive,
  [QUEUE_NAMES.LEAGUES_META]: processLeaguesMeta,
  [QUEUE_NAMES.SETTLEMENT_RETRY]: processSettlementRetry,
};

const workers = [];
const BULL_LOCK_DURATION_MS = Number(
  process.env.BULL_LOCK_DURATION_MS || 300_000,
);

function buildWorker(queueName, processor) {
  const worker = new Worker(
    queueName,
    async (job) => {
      const start = Date.now();
      console.log(`[worker:${queueName}] job ${job.id} (${job.name}) starting`);
      try {
        const result = await processor(job);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(
          `[worker:${queueName}] job ${job.id} (${job.name}) done in ${elapsed}s`,
        );
        return result;
      } catch (err) {
        console.error(
          `[worker:${queueName}] job ${job.id} (${job.name}) failed:`,
          err.message,
        );
        throw err;
      }
    },
    {
      connection: getQueueConnection(),
      prefix: getQueuePrefix(),
      concurrency: 1,
      lockDuration: BULL_LOCK_DURATION_MS,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[worker:${queueName}] job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message,
    );
  });
  worker.on("error", (err) => {
    console.error(`[worker:${queueName}] worker error:`, err.message);
  });

  return worker;
}

async function shutdown(signal) {
  console.log(`[worker] received ${signal}, shutting down…`);
  try {
    await stopScheduler();
    await Promise.all(workers.map((w) => w.close().catch(() => {})));
    await closeQueues();
    await closeQueueConnections();
    await prisma.$disconnect().catch(() => {});
  } catch (err) {
    console.error("[worker] shutdown error:", err);
  } finally {
    process.exit(0);
  }
}

async function main() {
  await prisma.$connect();
  console.log("[worker] MongoDB connected via Prisma");

  const redisOk = await pingRedis();
  if (!redisOk) {
    console.error(
      "[worker] Redis not reachable – cannot run queues. Set REDIS_URL.",
    );
    process.exit(1);
  }
  console.log("[worker] Redis reachable");

  for (const [queueName, processor] of Object.entries(PROCESSOR_REGISTRY)) {
    workers.push(buildWorker(queueName, processor));
    console.log(`[worker] attached processor on queue "${queueName}"`);
  }

  await startScheduler();
  console.log("[worker] ready – scheduler started, processors attached");
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => {
  console.error("[worker] unhandledRejection:", err);
});

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
