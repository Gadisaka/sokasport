import Redis from "ioredis";

export const TTL = {
  LEAGUES: 86400,
  TEAMS: 86400,
  FIXTURES: 1800,
  /** Sidebar league catalog (pinned ∪ fixtures in odds horizon) */
  SIDEBAR_LEAGUES: 90,
  ODDS: 300,
  LIVE: 30,
  API_UPSTREAM: Number(process.env.API_SPORTS_CACHE_TTL || 300),
};

const KEY_PREFIX = process.env.REDIS_KEY_PREFIX
  ? `${process.env.REDIS_KEY_PREFIX}:`
  : "";

let redis = null;
let lastConnectLogAt = 0;

function buildKey(key) {
  return `${KEY_PREFIX}${key}`;
}

function getRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      connectTimeout: 2000,
      commandTimeout: 1500,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    redis.on("error", (err) => {
      const now = Date.now();
      if (now - lastConnectLogAt > 10_000) {
        console.error("[Redis] connection error:", err.message);
        lastConnectLogAt = now;
      }
    });

    redis.on("connect", () => {
      console.log("[Redis] connected");
    });

    redis.on("ready", () => {
      console.log("[Redis] ready");
    });

    redis.connect().catch(() => {});
  }
  return redis;
}

export async function pingRedis() {
  try {
    const reply = await getRedis().ping();
    return reply === "PONG";
  } catch {
    return false;
  }
}

export async function getCache(key) {
  try {
    const raw = await getRedis().get(buildKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setCache(key, data, ttlSeconds) {
  try {
    await getRedis().set(
      buildKey(key),
      JSON.stringify(data),
      "EX",
      ttlSeconds,
    );
  } catch {
    // cache write failures are non-fatal
  }
}

export async function deleteCache(key) {
  try {
    await getRedis().del(buildKey(key));
  } catch {
    // cache delete failures are non-fatal
  }
}

/**
 * Cache-aside helper: returns cached value when present, otherwise runs
 * `loader`, stores the result under `key` with `ttl`, and returns it.
 * `loader` errors bubble up so callers can react; cache errors are swallowed.
 */
export async function withCache(key, ttlSeconds, loader) {
  const cached = await getCache(key);
  if (cached !== null && cached !== undefined) return cached;

  const fresh = await loader();
  if (fresh !== null && fresh !== undefined) {
    await setCache(key, fresh, ttlSeconds);
  }
  return fresh;
}

/**
 * Delete all keys matching a pattern using SCAN (safe for production –
 * KEYS would block the server). Pattern is automatically prefixed.
 */
export async function deleteByPattern(pattern) {
  try {
    const client = getRedis();
    const match = buildKey(pattern);
    const stream = client.scanStream({ match, count: 200 });
    const pipeline = client.pipeline();
    let batched = 0;

    for await (const keys of stream) {
      if (!keys.length) continue;
      for (const k of keys) pipeline.del(k);
      batched += keys.length;
    }

    if (batched > 0) await pipeline.exec();
    return batched;
  } catch {
    return 0;
  }
}

export function getRedisClient() {
  return getRedis();
}
