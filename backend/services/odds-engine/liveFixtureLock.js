import { getRedisClient } from "../cacheService.js";
import { publishMarketEvent } from "../../lib/socketHub.js";

export const FIXTURE_LOCK_KEY_PREFIX = "live-fixture-lock-until:";

export function fixtureLockKey(apiFixtureId) {
  return `${FIXTURE_LOCK_KEY_PREFIX}${apiFixtureId}`;
}

export async function lockFixture(apiFixtureId, { reason = "event", lockMs } = {}) {
  const id = Number(apiFixtureId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const ms = Math.max(1000, Number(lockMs) || 0);
  const redis = getRedisClient();
  const key = fixtureLockKey(id);
  const lockUntil = Date.now() + ms;
  try {
    await redis.set(key, "1", "PX", ms);
  } catch (err) {
    console.error(
      `[liveFixtureLock] lockFixture failed for ${id}:`,
      err?.message || err,
    );
    return null;
  }
  await publishMarketEvent({
    event: "market:locked",
    apiFixtureId: id,
    reason,
    lockUntil,
  }).catch(() => {});
  return { apiFixtureId: id, lockUntil, reason };
}

export async function readFixtureLockRemainingMs(redis, apiFixtureIds = []) {
  const ids = [
    ...new Set(
      apiFixtureIds
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0),
    ),
  ];
  const out = new Map();
  if (!ids.length) return out;
  const client = redis || getRedisClient();
  try {
    const pipe = client.pipeline();
    for (const id of ids) pipe.pttl(fixtureLockKey(id));
    const res = (await pipe.exec()) || [];
    ids.forEach((id, i) => {
      const pttl = Array.isArray(res[i]) ? Number(res[i][1]) : NaN;
      out.set(id, Number.isFinite(pttl) && pttl > 0 ? pttl : 0);
    });
  } catch {
    for (const id of ids) out.set(id, 0);
  }
  return out;
}

export async function clearFixtureLock(apiFixtureId) {
  const id = Number(apiFixtureId);
  if (!Number.isFinite(id) || id <= 0) return;
  const redis = getRedisClient();
  try {
    await redis.del(fixtureLockKey(id));
  } catch {
    /* fail-soft */
  }
}
