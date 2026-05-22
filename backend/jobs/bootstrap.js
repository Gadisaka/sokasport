import prisma from "../Config/db.js";
import { getRedisClient } from "../services/cacheService.js";
import { getFixturesDaysAhead } from "../Config/ingestionConfig.js";
import { getQueue, QUEUE_NAMES } from "../queues/queues.js";
import syncBookmakers from "./syncBookmakers.js";

/**
 * Boot-time orchestrator.
 *
 * On API start, if there are no fixtures in the UTC calendar window for the
 * next FIXTURES_DAYS_AHEAD days (default 14 — same as the deep fixture job),
 * enqueue a bulk ingest so cold restarts are usable immediately. When data
 * already exists, skip and let the worker's repeatables (near-window + deep horizon)
 * handle updates.
 *
 * The Redis lock debounces concurrent enqueues from multiple API instances or
 * rapid `node --watch` reloads.
 */

const LOCK_KEY = "bootstrap:lock";
const LOCK_TTL_SECONDS = 120;

function keyWithPrefix(key) {
  const prefix = process.env.REDIS_KEY_PREFIX
    ? `${process.env.REDIS_KEY_PREFIX}:`
    : "";
  return `${prefix}${key}`;
}

/** Same UTC window as `startEndUtcWindow` in footballPublic / sync jobs. */
function startEndUtcWindow(days) {
  const safeDays = Math.max(1, Number(days) || 1);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + safeDays - 1);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

async function needsFixtureHorizonBackfill(days) {
  const { start, end } = startEndUtcWindow(days);
  try {
    const n = await prisma.fixture.count({
      where: { start_time: { gte: start, lte: end } },
    });
    return n === 0;
  } catch (err) {
    console.error("[bootstrap] horizon check failed:", err.message);
    return true;
  }
}

async function tryAcquireLock() {
  try {
    const client = getRedisClient();
    const ok = await client.set(
      keyWithPrefix(LOCK_KEY),
      String(process.pid),
      "EX",
      LOCK_TTL_SECONDS,
      "NX",
    );
    return ok === "OK";
  } catch {
    return true;
  }
}

async function releaseLock() {
  try {
    await getRedisClient().del(keyWithPrefix(LOCK_KEY));
  } catch {
    // lock TTL will expire anyway
  }
}

/**
 * Seed the bookmaker catalog from upstream when the table is empty so the
 * admin picker shows every provider on first boot. Best-effort: any error
 * is logged and swallowed – fixture bootstrap must still proceed.
 */
async function seedBookmakersIfEmpty() {
  try {
    const count = await prisma.bookmaker.count();
    if (count > 0) return { skipped: true, reason: "already_seeded", count };

    console.log("[bootstrap] bookmakers table empty – seeding from upstream");
    const result = await syncBookmakers({ force: false });
    return { skipped: false, ...result };
  } catch (err) {
    console.error("[bootstrap] bookmaker seed failed:", err.message);
    return { skipped: true, reason: "error", error: err.message };
  }
}

/**
 * Fire-and-forget enqueue. Idempotent – BullMQ deduplicates by `jobId`.
 */
export async function runBootstrap({ force = false } = {}) {
  const horizonDays = getFixturesDaysAhead();

  // Seed the bookmaker catalog regardless of whether fixtures need a
  // backfill – it's a tiny upstream call (1 request, 24h cached) and it
  // unblocks the admin picker on cold installs.
  await seedBookmakersIfEmpty();

  if (!force && !(await needsFixtureHorizonBackfill(horizonDays))) {
    console.log(
      `[bootstrap] skipping enqueue – fixtures present in ${horizonDays}d UTC window`,
    );
    return { skipped: true, reason: "horizon_ok", horizonDays };
  }

  const gotLock = await tryAcquireLock();
  if (!gotLock) {
    console.log(
      "[bootstrap] skipping – another process holds the lock (concurrent restart?)",
    );
    return { skipped: true, reason: "locked", horizonDays };
  }

  try {
    const q = getQueue(QUEUE_NAMES.FIXTURES_BULK);
    await q.add(
      "fixtures:bootstrap",
      {
        daysAhead: horizonDays,
        label: force ? "bootstrap-force" : "bootstrap",
      },
      {
        jobId: "bootstrap-fixtures-bulk",
        removeOnComplete: 5,
        removeOnFail: 50,
      },
    );

    console.log(
      `[bootstrap] enqueued sync-fixtures-bulk (${horizonDays}d, worker will run)`,
    );
    return {
      skipped: false,
      enqueued: true,
      horizonDays,
      force: Boolean(force),
    };
  } catch (err) {
    console.error("[bootstrap] failed to enqueue:", err);
    throw err;
  } finally {
    await releaseLock();
  }
}

export default runBootstrap;
