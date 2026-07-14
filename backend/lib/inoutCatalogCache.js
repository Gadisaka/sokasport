/**
 * Shared cache key + TTL for the public InOut game catalog so the sync job,
 * public route, and admin mutations all invalidate/read the same entry.
 *
 * @module lib/inoutCatalogCache
 */

/** Redis cache key for the enabled, ordered game list served to players. */
export const INOUT_GAMES_CACHE_KEY = "inout:games:enabled";

/** TTL (seconds) for the public catalog cache. */
export const INOUT_GAMES_CACHE_TTL = 300;
