import { prisma } from "../Config/db.js";
import { getCache, setCache, TTL } from "./cacheService.js";
import { getPreferredBookmakerRecord } from "./settingsService.js";
import { isPublicFixturesStrictBookmaker } from "../Config/ingestionConfig.js";
import { getLeagueRank } from "../Config/leagueRanks.js";

/** Slim list endpoint GET /fixtures?date= — Match Winner + Double Chance only. */
const FIXTURES_SUMMARY_ODD_LINES_PER_MARKET = Number(
  process.env.FIXTURES_SUMMARY_ODD_LINES_PER_MARKET || 3,
);
const FIXTURES_SUMMARY_MARKET_LIMIT = Number(
  process.env.FIXTURES_SUMMARY_MARKET_LIMIT || 2,
);
const SUMMARY_MARKET_NAMES = ["Match Winner", "Double Chance"];
const UPCOMING_FIXTURES_LIMIT = Number(
  process.env.UPCOMING_FIXTURES_LIMIT || 800,
);
const UPCOMING_MIN_START_BUFFER_MINUTES = 5;
const UPCOMING_ALLOWED_STATUSES = new Set(["NS", "TBD"]);

/** Bumped when list payload / query semantics change (slim select, no bookmaker join). */
export const FIXTURES_BY_DATE_CACHE_VERSION = "v5";

const MAIN_MARKET_NAMES = [
  "Match Winner",
  "Double Chance",
  "Goals Over/Under",
  "Both Teams Score",
];

/** In-process single-flight for list rebuilds (keyed by cache key). */
const fixturesByDateInflight = new Map();

/** Process-local warm cache so API hits avoid Redis/Mongo under worker load. */
const MEMORY_TTL_MS = Number(process.env.FIXTURES_MEMORY_TTL_MS || 30_000);
const fixturesByDateMemory = new Map();

/** Coalesce concurrent worker refreshes. */
let refreshInflight = null;

/**
 * Build a Prisma `include` clause for fixture.markets that optionally
 * filters odd_lines down to a single bookmaker.
 */
export function buildMarketsInclude(
  preferredBookmakerId,
  { marketLimit, oddLineLimit, mainMarketsOnly, marketNamesIn, includeBookmaker = true } = {},
) {
  const oddLines = {
    where: preferredBookmakerId
      ? { bookmaker_id: preferredBookmakerId }
      : undefined,
    ...(includeBookmaker
      ? { include: { bookmaker: true } }
      : { select: { id: true, value: true, odd: true, bookmaker_id: true } }),
  };
  if (Number.isFinite(oddLineLimit) && oddLineLimit > 0) {
    oddLines.take = oddLineLimit;
    oddLines.orderBy = { value: "asc" };
  }

  const include = includeBookmaker
    ? { include: { odd_lines: oddLines } }
    : { select: { id: true, name: true, odd_lines: oddLines } };

  if (Array.isArray(marketNamesIn) && marketNamesIn.length > 0) {
    include.where = { name: { in: marketNamesIn } };
  } else if (mainMarketsOnly) {
    include.where = { name: { in: MAIN_MARKET_NAMES } };
  }

  if (Number.isFinite(marketLimit) && marketLimit > 0) {
    include.take = marketLimit;
    include.orderBy = { name: "asc" };
  }
  return include;
}

export function stripEmptyMarkets(fixture) {
  if (!fixture || !Array.isArray(fixture.markets)) return fixture;
  fixture.markets = fixture.markets.filter(
    (m) => Array.isArray(m.odd_lines) && m.odd_lines.length > 0,
  );
  return fixture;
}

export function fixtureHasPricedOdds(fixture) {
  const markets = fixture?.markets;
  if (!Array.isArray(markets) || markets.length === 0) return false;
  return markets.some(
    (m) => Array.isArray(m.odd_lines) && m.odd_lines.length > 0,
  );
}

export function bookmakerCacheSuffix(preferredBookmaker) {
  if (!preferredBookmaker) return "bk-all";
  return `bk-${preferredBookmaker.api_bookmaker_id}`;
}

export function fixturesListCacheModeSuffix() {
  return isPublicFixturesStrictBookmaker() ? "strict" : "relaxed";
}

export function sortFixturesByLeagueRank(fixtures, limit = null) {
  const sorted = [...(fixtures || [])].sort((a, b) => {
    const rankA = getLeagueRank(a?.league?.api_league_id);
    const rankB = getLeagueRank(b?.league?.api_league_id);
    if (rankA !== rankB) return rankA - rankB;
    return (
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );
  });
  if (limit != null && limit > 0) return sorted.slice(0, limit);
  return sorted;
}

export function attachLeagueRank(fixture) {
  if (!fixture?.league) return fixture;
  return {
    ...fixture,
    league: {
      ...fixture.league,
      rank: getLeagueRank(fixture.league.api_league_id),
    },
  };
}

export function attachLeagueRanksToList(fixtures) {
  return (fixtures || []).map(attachLeagueRank);
}

/**
 * Preferred-bookmaker rows first; when relaxed mode and preferred is set,
 * fill fixtures missing markets using any bookmaker (same caps).
 * Prefer calling with bookmakerFilterId=null in relaxed mode so the first
 * query already includes fallback markets and this second pass is a no-op.
 */
export async function mergeMarketsFallbackForList(rows, preferred, caps) {
  if (!preferred?.id || isPublicFixturesStrictBookmaker()) {
    return rows.map(stripEmptyMarkets);
  }

  let data = rows.map(stripEmptyMarkets);
  const ids = data
    .filter((fx) => !Array.isArray(fx.markets) || fx.markets.length === 0)
    .map((fx) => fx.id);
  if (!ids.length) return data;

  const extras = await prisma.fixture.findMany({
    where: { id: { in: ids } },
    include: {
      markets: buildMarketsInclude(null, { ...caps, includeBookmaker: false }),
    },
  });

  const byId = new Map();
  for (const x of extras) {
    stripEmptyMarkets(x);
    byId.set(x.id, x.markets || []);
  }

  return data.map((fx) => {
    if (fx.markets?.length) return fx;
    const mk = byId.get(fx.id);
    return mk?.length ? { ...fx, markets: mk } : fx;
  });
}

export function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export function parseUtcYmd(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const start = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
  if (
    start.getUTCFullYear() !== y ||
    start.getUTCMonth() !== mo - 1 ||
    start.getUTCDate() !== d
  ) {
    return null;
  }
  const end = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
  return { start, end, ymd: dateStr.trim() };
}

export function upcomingCutoffStart(baseStart) {
  const nowPlusBuffer = new Date(
    Date.now() + UPCOMING_MIN_START_BUFFER_MINUTES * 60 * 1000,
  );
  return baseStart > nowPlusBuffer ? baseStart : nowPlusBuffer;
}

export function filterUpcomingByStartBuffer(fixtures) {
  const cutoff = Date.now() + UPCOMING_MIN_START_BUFFER_MINUTES * 60 * 1000;
  return (fixtures || []).filter((fixture) => {
    const ts = new Date(fixture?.start_time).getTime();
    const status = String(fixture?.status || "").toUpperCase();
    return (
      Number.isFinite(ts) &&
      ts > cutoff &&
      UPCOMING_ALLOWED_STATUSES.has(status)
    );
  });
}

export function fixturesByDateCacheKey(ymd, preferred) {
  return `fixtures:by-date:${FIXTURES_BY_DATE_CACHE_VERSION}:${ymd}:${bookmakerCacheSuffix(preferred)}:${fixturesListCacheModeSuffix()}`;
}

/**
 * Bookmaker id to use in the first list query.
 * Relaxed mode: null (any persisted bookmaker) — odds sync stores one
 * bookmaker per fixture, so preferred filtering only forces a second query.
 * Strict mode: preferred id when set.
 */
function listQueryBookmakerId(preferred) {
  if (isPublicFixturesStrictBookmaker()) {
    return preferred?.id ?? null;
  }
  return null;
}

function rememberFixtures(cacheKey, data) {
  fixturesByDateMemory.set(cacheKey, { at: Date.now(), data });
}

function memoryFixtures(cacheKey) {
  const hit = fixturesByDateMemory.get(cacheKey);
  if (!hit) return null;
  if (Date.now() - hit.at > MEMORY_TTL_MS) {
    fixturesByDateMemory.delete(cacheKey);
    return null;
  }
  return hit.data;
}

/**
 * Rebuild fixtures for one UTC day and write Redis (overwrite, no delete).
 * Uses a slim select + "has priced summary markets" filter so the day query
 * does not pull full team/league docs or bookmaker joins for every fixture.
 */
export async function buildFixturesByDate(ymd, { preferred } = {}) {
  const parsed = parseUtcYmd(ymd);
  if (!parsed) {
    throw new Error(`Invalid UTC date: ${ymd}`);
  }

  const preferredRecord =
    preferred === undefined ? await getPreferredBookmakerRecord() : preferred;
  const cacheKey = fixturesByDateCacheKey(parsed.ymd, preferredRecord);

  let rangeStart = parsed.start;
  const rangeEnd = parsed.end;
  if (parsed.ymd === utcTodayYmd()) {
    rangeStart = upcomingCutoffStart(parsed.start);
  }

  const bookmakerId = listQueryBookmakerId(preferredRecord);
  const t0 = Date.now();

  const oddLinesQuery = {
    where: bookmakerId ? { bookmaker_id: bookmakerId } : undefined,
    take: FIXTURES_SUMMARY_ODD_LINES_PER_MARKET,
    orderBy: { value: "asc" },
    select: { id: true, value: true, odd: true },
  };

  const rows = await prisma.fixture.findMany({
    where: {
      start_time: { gte: rangeStart, lte: rangeEnd },
      status: { in: [...UPCOMING_ALLOWED_STATUSES] },
      // Skip unpriced fixtures in Mongo instead of loading them then filtering.
      markets: {
        some: {
          name: { in: SUMMARY_MARKET_NAMES },
          odd_lines: bookmakerId
            ? { some: { bookmaker_id: bookmakerId } }
            : { some: {} },
        },
      },
    },
    select: {
      id: true,
      api_fixture_id: true,
      start_time: true,
      status: true,
      home_score: true,
      away_score: true,
      extra_markets_count: true,
      available_odd_cells_count: true,
      home_team: {
        select: { id: true, name: true, logo: true, api_team_id: true },
      },
      away_team: {
        select: { id: true, name: true, logo: true, api_team_id: true },
      },
      league: {
        select: {
          id: true,
          name: true,
          country: true,
          logo: true,
          country_flag: true,
          api_league_id: true,
        },
      },
      markets: {
        where: { name: { in: SUMMARY_MARKET_NAMES } },
        take: FIXTURES_SUMMARY_MARKET_LIMIT,
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          odd_lines: oddLinesQuery,
        },
      },
    },
    orderBy: { start_time: "asc" },
  });

  let merged = rows.map(stripEmptyMarkets);
  // Strict mode may still need a fallback pass when preferred filter was used.
  if (bookmakerId) {
    merged = await mergeMarketsFallbackForList(merged, preferredRecord, {
      marketLimit: FIXTURES_SUMMARY_MARKET_LIMIT,
      oddLineLimit: FIXTURES_SUMMARY_ODD_LINES_PER_MARKET,
      marketNamesIn: SUMMARY_MARKET_NAMES,
      includeBookmaker: false,
    });
  }

  merged = merged.filter(fixtureHasPricedOdds);
  merged = sortFixturesByLeagueRank(merged, UPCOMING_FIXTURES_LIMIT);

  const data = attachLeagueRanksToList(merged);
  await setCache(cacheKey, data, TTL.FIXTURES);
  rememberFixtures(cacheKey, data);
  console.log(
    `[fixturesList] build ${parsed.ymd} count=${data.length} ms=${Date.now() - t0}`,
  );
  return data;
}

/**
 * Cache-aside with memory → Redis → single-flight DB rebuild.
 */
export async function getOrBuildFixturesByDate(ymd) {
  const preferred = await getPreferredBookmakerRecord();
  const parsed = parseUtcYmd(ymd);
  if (!parsed) {
    throw new Error(`Invalid UTC date: ${ymd}`);
  }

  const cacheKey = fixturesByDateCacheKey(parsed.ymd, preferred);

  const mem = memoryFixtures(cacheKey);
  if (mem) return mem;

  const cached = await getCache(cacheKey);
  if (cached) {
    rememberFixtures(cacheKey, cached);
    return cached;
  }

  let inflight = fixturesByDateInflight.get(cacheKey);
  if (!inflight) {
    inflight = buildFixturesByDate(parsed.ymd, { preferred }).finally(() => {
      fixturesByDateInflight.delete(cacheKey);
    });
    fixturesByDateInflight.set(cacheKey, inflight);
  }
  return inflight;
}

function addUtcDaysYmd(ymd, days) {
  const parsed = parseUtcYmd(ymd);
  if (!parsed) return null;
  const next = new Date(parsed.start);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/**
 * Rebuild-then-swap for today + tomorrow so public list caches stay warm
 * after sync jobs instead of being deleted (cold miss for visitors).
 * Concurrent callers share one in-flight refresh.
 */
export async function refreshFixturesByDateCaches() {
  if (refreshInflight) return refreshInflight;

  refreshInflight = (async () => {
    const today = utcTodayYmd();
    const tomorrow = addUtcDaysYmd(today, 1);
    const dates = [today, tomorrow].filter(Boolean);

    const preferred = await getPreferredBookmakerRecord();
    const results = [];
    for (const ymd of dates) {
      try {
        const data = await buildFixturesByDate(ymd, { preferred });
        results.push({ ymd, count: Array.isArray(data) ? data.length : 0 });
      } catch (err) {
        console.error(
          `[fixturesList] refresh ${ymd} failed:`,
          err?.message || err,
        );
        results.push({ ymd, error: String(err?.message || err) });
      }
    }
    return results;
  })().finally(() => {
    refreshInflight = null;
  });

  return refreshInflight;
}
