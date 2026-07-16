import { getRedisClient } from "./cacheService.js";
import { bumpMarketVersion } from "./odds-engine/versioning.js";

// Single canonical snapshot TTL, shared by the pollers (via liveFixtureRefresh)
// and the resolver's API fallback. Set comfortably above the 60s slow poll and
// well above the resolver's freshness max-age (LIVE_ODDS_MAX_AGE_MS, ~15s) so a
// still-fresh snapshot is never evicted early — freshness is governed by the
// explicit age check in resolveLiveOdds, NOT by this TTL.
export const LIVE_ODDS_SNAPSHOT_TTL_SECONDS = Number(
  process.env.LIVE_ODDS_SNAPSHOT_TTL_SECONDS || 90,
);

/**
 * Write live odds for a single fixture to Redis.
 * Accepts parsed odds in the standard { bookmakers: [...] } format.
 *
 * @param {number} apiFixtureId - API-Sports fixture ID
 * @param {object} parsed - Parsed odds with { bookmakers: [{ markets: [{ name, values: [{ value, odd }] }] }] }
 */
export async function writeLiveOddsSnapshot(apiFixtureId, parsed) {
  if (!Number.isFinite(Number(apiFixtureId))) return;
  const redis = getRedisClient();
  const oddsKey = `live-odds:${apiFixtureId}`;
  const stateKey = `live-market-state:${apiFixtureId}`;
  const versionKey = `live-market-version:${apiFixtureId}`;
  const updatedAtKey = `live-market-updated-at:${apiFixtureId}`;
  const oddsFields = {};
  const stateFields = {};
  const versionFields = {};
  const updatedFields = {};
  const prevVersionFields = await redis.hgetall(versionKey);
  const nowIso = new Date().toISOString();
  for (const bookmaker of parsed?.bookmakers || []) {
    for (const market of bookmaker?.markets || []) {
      const marketName = String(market?.name || "").trim();
      if (!marketName) continue;
      for (const value of market?.values || []) {
        const label = String(value?.value || "").trim();
        const odd = Number(value?.odd);
        if (!label || !Number.isFinite(odd)) continue;
        const field = `${marketName}|${label}`;
        oddsFields[field] = odd;
        stateFields[field] = "OPEN";
        versionFields[field] = bumpMarketVersion(
          prevVersionFields[field],
          Date.now(),
        );
        updatedFields[field] = nowIso;
      }
    }
  }
  if (!Object.keys(oddsFields).length) return;
  await redis.del(oddsKey);
  await redis.del(stateKey);
  await redis.del(updatedAtKey);
  await redis.hset(oddsKey, oddsFields);
  await redis.hset(stateKey, stateFields);
  await redis.hset(versionKey, versionFields);
  await redis.hset(updatedAtKey, updatedFields);
  await redis.expire(oddsKey, LIVE_ODDS_SNAPSHOT_TTL_SECONDS);
  await redis.expire(stateKey, LIVE_ODDS_SNAPSHOT_TTL_SECONDS);
  await redis.expire(versionKey, LIVE_ODDS_SNAPSHOT_TTL_SECONDS);
  await redis.expire(updatedAtKey, LIVE_ODDS_SNAPSHOT_TTL_SECONDS);
}
