import { getRedisClient } from "./cacheService.js";
import { bumpMarketVersion } from "./odds-engine/versioning.js";

export const LIVE_ODDS_SNAPSHOT_TTL_SECONDS = Number(
  process.env.LIVE_ODDS_SNAPSHOT_TTL_SECONDS || 60,
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

/**
 * Write live odds from raw API-Sports /odds/live response format.
 * This is the format returned directly by getLiveOdds().
 *
 * @param {Array} rawLiveOdds - Array of API-Sports live odds entries
 */
export async function writeLiveOddsFromApiResponse(rawLiveOdds) {
  if (!Array.isArray(rawLiveOdds) || rawLiveOdds.length === 0) return;

  const writes = [];
  for (const entry of rawLiveOdds) {
    const fixtureId = entry.fixture?.id;
    if (!Number.isFinite(fixtureId)) continue;

    const odds = entry.odds || [];
    if (!odds.length) continue;

    const parsed = {
      bookmakers: [
        {
          markets: odds
            .filter(
              (o) => o.name && Array.isArray(o.values) && o.values.length > 0,
            )
            .map((o) => ({
              name: o.name,
              values: o.values
                .filter((v) => !v.suspended && v.odd)
                .map((v) => ({
                  value: v.handicap ? `${v.value} ${v.handicap}` : v.value,
                  odd: Number.parseFloat(v.odd),
                })),
            }))
            .filter((m) => m.values.length > 0),
        },
      ],
    };

    if (parsed.bookmakers[0].markets.length > 0) {
      writes.push(writeLiveOddsSnapshot(fixtureId, parsed));
    }
  }

  await Promise.all(writes);
}
