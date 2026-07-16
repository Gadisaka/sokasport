import { getRedisClient } from "../../services/cacheService.js";

/**
 * Redis last-seen score cache for the fast score poller. Lets the 5s poll gate
 * change detection WITHOUT a Mongo read on the (common) no-change path — only a
 * genuine delta vs the cached baseline drops to the heavy Mongo+refresh branch.
 *
 * Value is the compact tuple "home:away:status" (empty segment = null score).
 */

export const SCORE_CACHE_KEY_PREFIX = "live-score:";

export function scoreCacheKey(apiFixtureId) {
  return `${SCORE_CACHE_KEY_PREFIX}${apiFixtureId}`;
}

/** Encode `{ homeScore, awayScore, status }` → "h:a:status" (null → ""). */
export function encodeScore({ homeScore, awayScore, status }) {
  const h = homeScore ?? "";
  const a = awayScore ?? "";
  return `${h}:${a}:${status ?? ""}`;
}

/** Parse "h:a:status" → `{ homeScore, awayScore, status }`, or null. */
export function parseScore(encoded) {
  if (encoded == null) return null;
  const [h = "", a = "", status = ""] = String(encoded).split(":");
  return {
    homeScore: h === "" ? null : Number(h),
    awayScore: a === "" ? null : Number(a),
    status: status || null,
  };
}

/**
 * Classify the current tuple against the cached baseline:
 *   - "seed":    no baseline yet (first sight) — cannot infer an event.
 *   - "skip":    identical to baseline — nothing happened.
 *   - "changed": differs from baseline — a real in-play delta to act on.
 */
export function classifyScoreChange(curEncoded, cachedEncoded) {
  if (cachedEncoded == null) return "seed";
  return curEncoded === cachedEncoded ? "skip" : "changed";
}

/**
 * Batch-read the last-seen tuple for a set of fixtures. Returns Map<id, string|null>.
 * Fail-soft: on a Redis error every id maps to null (→ treated as first sight,
 * i.e. seed-no-lock, never a false positive).
 */
export async function readScoreCache(redis, apiFixtureIds = []) {
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
    for (const id of ids) pipe.get(scoreCacheKey(id));
    const res = (await pipe.exec()) || [];
    ids.forEach((id, i) => {
      out.set(id, Array.isArray(res[i]) ? res[i][1] ?? null : null);
    });
  } catch {
    for (const id of ids) out.set(id, null);
  }
  return out;
}

/** Write/refresh the baseline for one fixture with an EX TTL (seconds). Fail-soft. */
export async function writeScoreCache(redis, apiFixtureId, encoded, ttlSeconds) {
  const id = Number(apiFixtureId);
  if (!Number.isFinite(id) || id <= 0) return;
  const client = redis || getRedisClient();
  const ttl = Math.max(1, Math.ceil(Number(ttlSeconds) || 1));
  try {
    await client.set(scoreCacheKey(id), String(encoded), "EX", ttl);
  } catch {
    /* fail-soft */
  }
}
