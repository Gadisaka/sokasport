import axios from "axios";
import {
  SPORT_PROVIDERS,
  getProviderConfig,
  isSportEnabled,
} from "./sportsRegistry.js";
import { getCache, setCache, TTL } from "./cacheService.js";

const REQUEST_TIMEOUT_MS = Number(process.env.API_SPORTS_TIMEOUT_MS || 30000);
const MAX_NETWORK_RETRIES = Number(process.env.API_SPORTS_MAX_RETRIES || 2);
const MAX_RATE_LIMIT_RETRIES = 3;
const RETRY_BACKOFF_MS = 2000;
const RATE_LIMIT_DELAY_MS = 7000;
const DAILY_CALL_LIMIT = Number(process.env.API_SPORTS_DAILY_LIMIT || 75000);

const clients = new Map();
const dailyCalls = new Map();
let lastResetDate = new Date().toISOString().split("T")[0];

function resetDailyCountersIfNeeded() {
  const today = new Date().toISOString().split("T")[0];
  if (today !== lastResetDate) {
    for (const [sport, used] of dailyCalls.entries()) {
      console.log(
        `[API-Sports/${sport}] daily counter reset – yesterday used ${used} calls`,
      );
    }
    dailyCalls.clear();
    lastResetDate = today;
  }
}

function incrCount(sport) {
  dailyCalls.set(sport, (dailyCalls.get(sport) ?? 0) + 1);
}

function countFor(sport) {
  return dailyCalls.get(sport) ?? 0;
}

export function getDailyCallCount(sport = "football") {
  resetDailyCountersIfNeeded();
  return countFor(sport);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetriableNetworkError(err) {
  const code = err?.code;
  return (
    code === "ECONNABORTED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND"
  );
}

function getClient(sport) {
  if (clients.has(sport)) return clients.get(sport);

  const cfg = getProviderConfig(sport);
  if (!cfg) {
    throw new Error(`[API-Sports] unknown sport "${sport}"`);
  }
  if (!cfg.apiKey) {
    throw new Error(
      `[API-Sports] ${sport}: missing API key (set env ${cfg.apiKeyEnv})`,
    );
  }

  const client = axios.create({
    baseURL: cfg.baseURL,
    headers: { "x-apisports-key": cfg.apiKey },
    timeout: REQUEST_TIMEOUT_MS,
  });
  clients.set(sport, client);
  return client;
}

function buildCacheKey(sport, endpoint, params) {
  const normalized = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `apisports:${sport}:${endpoint}${normalized ? `?${normalized}` : ""}`;
}

function isCacheableRequest(endpoint, params) {
  // Never cache live feeds – they need to be fresh every poll.
  if (params && params.live) return false;
  if (endpoint.includes("/live")) return false;
  return true;
}

async function request(sport, endpoint, params = {}, attempt = 0, opts = {}, rateLimitAttempt = 0) {
  resetDailyCountersIfNeeded();

  if (!isSportEnabled(sport)) {
    return [];
  }

  const cacheable = isCacheableRequest(endpoint, params) && !opts.skipCache;
  const cacheKey = cacheable ? buildCacheKey(sport, endpoint, params) : null;
  const ttl = opts.cacheTtl ?? TTL.API_UPSTREAM;

  if (cacheKey) {
    const cached = await getCache(cacheKey);
    if (cached !== null) return cached;
  }

  if (countFor(sport) >= DAILY_CALL_LIMIT) {
    console.warn(
      `[API-Sports/${sport}] daily limit reached (${DAILY_CALL_LIMIT}), skipping ${endpoint}`,
    );
    return [];
  }

  let client;
  try {
    client = getClient(sport);
  } catch (err) {
    console.error(err.message);
    return [];
  }

  try {
    incrCount(sport);
    const { data } = await client.get(endpoint, { params });

    if (countFor(sport) % 500 === 0) {
      console.log(
        `[API-Sports/${sport}] daily usage: ${countFor(sport)} / ${DAILY_CALL_LIMIT}`,
      );
    }

    if (data.errors && Object.keys(data.errors).length > 0) {
      if (data.errors.rateLimit) {
        if (rateLimitAttempt >= MAX_RATE_LIMIT_RETRIES) {
          console.error(
            `[API-Sports/${sport}] ${endpoint} rate-limit retries exhausted (${MAX_RATE_LIMIT_RETRIES}), giving up`,
          );
          return [];
        }
        console.warn(
          `[API-Sports/${sport}] rate limited, retry ${rateLimitAttempt + 1}/${MAX_RATE_LIMIT_RETRIES} in ${RATE_LIMIT_DELAY_MS}ms…`,
        );
        await sleep(RATE_LIMIT_DELAY_MS);
        return request(sport, endpoint, params, attempt, opts, rateLimitAttempt + 1);
      }
      console.error(
        `[API-Sports/${sport}] ${endpoint} errors:`,
        data.errors,
      );
      return [];
    }

    const response = data.response ?? [];
    if (cacheKey && Array.isArray(response) && response.length > 0) {
      await setCache(cacheKey, response, ttl);
    }
    return response;
  } catch (err) {
    if (isRetriableNetworkError(err) && attempt < MAX_NETWORK_RETRIES) {
      const waitMs = RETRY_BACKOFF_MS * (attempt + 1);
      console.warn(
        `[API-Sports/${sport}] ${endpoint} network error (${err.code ?? err.message}), retry ${attempt + 1}/${MAX_NETWORK_RETRIES} in ${waitMs}ms`,
      );
      await sleep(waitMs);
      return request(sport, endpoint, params, attempt + 1, opts, rateLimitAttempt);
    }

    console.error(
      `[API-Sports/${sport}] ${endpoint} failed (params=${JSON.stringify(params)}):`,
      err.response?.status ?? err.code ?? err.message,
    );
    return [];
  }
}

/**
 * Returns a provider-bound client with the same surface as the old
 * apiFootballService (getLeagues, getTeams, getFixtures, getOdds,
 * getLiveFixtures). Works for any sport registered in sportsRegistry.
 */
export function api(sport) {
  if (!SPORT_PROVIDERS[sport]) {
    throw new Error(`[API-Sports] unknown sport "${sport}"`);
  }

  const fixturesEndpoint =
    SPORT_PROVIDERS[sport].fixturesEndpoint ?? "/fixtures";

  return {
    sport,
    getLeagues: (opts) => request(sport, "/leagues", {}, 0, opts),
    getTeams: (leagueId, season, opts) =>
      request(sport, "/teams", { league: leagueId, season }, 0, opts),
    getFixtures: (leagueId, season, date, opts) => {
      const params = { league: leagueId };
      if (season) params.season = season;
      if (date) params.date = date;
      return request(sport, fixturesEndpoint, params, 0, opts);
    },
    /**
     * Bulk fetch every fixture (across ALL leagues) for a given calendar date.
     * One upstream call returns the day's slate; the response includes the
     * embedded league + team metadata so we can upsert everything inline.
     */
    getFixturesByDate: (date, opts) =>
      request(sport, fixturesEndpoint, { date }, 0, opts),
    getOdds: (fixtureId, opts) =>
      request(sport, "/odds", { fixture: fixtureId }, 0, opts),
    /**
     * Fetch the event timeline (goals, cards, substitutions…) for a
     * finalized fixture. Required by `GOALSCORER_*`, `PLAYER_CARDS`,
     * and any market that requires the normalized event stream. Cached
     * modestly — once a fixture is terminal the timeline rarely
     * changes.
     */
    getFixtureEvents: (fixtureId, opts) =>
      request(sport, "/fixtures/events", { fixture: fixtureId }, 0, opts),
    /**
     * Fetch match-level statistics (cards count, corners, shots) for a
     * finalized fixture. Used by `CARDS_OVER_UNDER`,
     * `CORNERS_OVER_UNDER`, and `PLAYER_SHOTS`.
     */
    getFixtureStatistics: (fixtureId, opts) =>
      request(sport, "/fixtures/statistics", { fixture: fixtureId }, 0, opts),
    getLiveFixtures: () =>
      request(sport, fixturesEndpoint, { live: "all" }, 0, { skipCache: true }),
    /**
     * Fetch live odds for all in-play fixtures in one call.
     * Returns real-time elapsed time, scores, and live odds.
     */
    getLiveOdds: () =>
      request(sport, "/odds/live", {}, 0, { skipCache: true }),
    /**
     * Fetch the full upstream bookmaker catalog (`/odds/bookmakers`).
     * The list is essentially static (rarely changes) so we cache it
     * aggressively – default 24h, override with `opts.cacheTtl`. The
     * admin "Sync bookmakers from upstream" action passes
     * `skipCache: true` to force a fresh pull.
     */
    getBookmakers: (opts) =>
      request(sport, "/odds/bookmakers", {}, 0, {
        cacheTtl: 24 * 60 * 60,
        ...opts,
      }),
  };
}
