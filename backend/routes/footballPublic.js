import { Router } from "express";
import { prisma } from "../Config/db.js";
import {
  deleteByPattern,
  getCache,
  getRedisClient,
  setCache,
  TTL,
} from "../services/cacheService.js";
import { api } from "../services/apiSportsService.js";
import { parseMarkets } from "../utils/oddsParser.js";
import { getDailyCallCount } from "../services/apiSportsService.js";
import { getPreferredBookmakerRecord } from "../services/settingsService.js";
import { getAllQueues } from "../queues/queues.js";
import { buildOddsParseOptions } from "../Config/oddsFilters.js";
import {
  getOddsHorizonDays,
  isPublicFixturesStrictBookmaker,
} from "../Config/ingestionConfig.js";
import {
  ALLOWED_LEAGUE_IDS,
  PREFERRED_LEAGUE_IDS,
} from "../Config/allowedLeagues.js";
import { recomputeExtraMarketsCountForFixture } from "../services/extraMarketsCount.js";

const router = Router();
const CACHE_SCAN_COUNT = 200;
const LIVE_FIXTURES_LIMIT = Number(process.env.LIVE_FIXTURES_LIMIT || 120);
const TODAY_MARKETS_PER_FIXTURE = Number(
  process.env.TODAY_MARKETS_PER_FIXTURE || 16,
);
const TODAY_ODD_LINES_PER_MARKET = Number(
  process.env.TODAY_ODD_LINES_PER_MARKET || 120,
);
const UPCOMING_WINDOW_DEFAULT_DAYS = Number(
  process.env.FIXTURES_WINDOW_DEFAULT_DAYS || 14,
);
const UPCOMING_WINDOW_MAX_DAYS = Number(
  process.env.FIXTURES_WINDOW_MAX_DAYS || 14,
);
const LIVE_MARKETS_PER_FIXTURE = Number(
  process.env.LIVE_MARKETS_PER_FIXTURE || 12,
);
const LIVE_ODD_LINES_PER_MARKET = Number(
  process.env.LIVE_ODD_LINES_PER_MARKET || 80,
);
const UPCOMING_FIXTURES_LIMIT = Number(
  process.env.UPCOMING_FIXTURES_LIMIT || 800,
);
const UPCOMING_MARKETS_PER_FIXTURE = Number(
  process.env.UPCOMING_MARKETS_PER_FIXTURE || 8,
);
const UPCOMING_ODD_LINES_PER_MARKET = Number(
  process.env.UPCOMING_ODD_LINES_PER_MARKET || 60,
);
/** Slim list endpoint GET /fixtures?date= — Match Winner + Double Chance only. */
const FIXTURES_SUMMARY_ODD_LINES_PER_MARKET = Number(
  process.env.FIXTURES_SUMMARY_ODD_LINES_PER_MARKET || 3,
);
const FIXTURES_SUMMARY_MARKET_LIMIT = Number(
  process.env.FIXTURES_SUMMARY_MARKET_LIMIT || 2,
);
const SUMMARY_MARKET_NAMES = ["Match Winner", "Double Chance"];
const UPCOMING_MIN_START_BUFFER_MINUTES = 5;
const UPCOMING_ALLOWED_STATUSES = new Set(["NS", "TBD"]);
const LIVE_SIDEBAR_STATUSES = ["LIVE", "HT"];
const LEGACY_MARKET_PATTERNS = [
  /match winner|match result|1x2/i,
  /over\/under|goals over\/under|total goals/i,
  /both teams( to)? score|btts/i,
  /double chance/i,
];

/** Reuse one upstream odds/live response across concurrent /fixtures/live + /odds/live. */
const LIVE_ODDS_COALESCE_MS = 2500;
// `transformed` is memoized alongside `raw` so /odds/live and /fixtures/live
// pay the O(fixtures × markets × values) transform cost ONCE per coalesce
// window instead of on every request. This was a primary contributor to
// the high backend CPU – the frontend polls /fixtures/live every 10s and
// each concurrent client previously triggered a full retransform.
let liveOddsSnapshot = { at: 0, raw: null, transformed: null };
let liveOddsInflight = null;

async function getRawLiveOddsCoalesced() {
  const now = Date.now();
  if (
    liveOddsSnapshot.raw !== null &&
    now - liveOddsSnapshot.at < LIVE_ODDS_COALESCE_MS
  ) {
    return liveOddsSnapshot.raw;
  }
  if (liveOddsInflight) return liveOddsInflight;

  liveOddsInflight = api("football")
    .getLiveOdds()
    .then((raw) => {
      // Reset transformed cache when raw changes – it will be lazily
      // rebuilt by the next call to `getTransformedLiveOddsCoalesced`.
      liveOddsSnapshot = { at: Date.now(), raw: raw ?? [], transformed: null };
      return liveOddsSnapshot.raw;
    })
    .finally(() => {
      liveOddsInflight = null;
    });

  return liveOddsInflight;
}

/**
 * Same coalescing semantics as `getRawLiveOddsCoalesced`, but returns the
 * client-shaped transformed payload. The transform is memoized per
 * coalesce window so back-to-back requests reuse the work.
 */
async function getTransformedLiveOddsCoalesced() {
  const raw = await getRawLiveOddsCoalesced();
  if (liveOddsSnapshot.transformed != null && liveOddsSnapshot.raw === raw) {
    return liveOddsSnapshot.transformed;
  }
  const transformed = transformLiveOddsForClient(raw);
  liveOddsSnapshot.transformed = transformed;
  return transformed;
}

/** Normalize API-Sports odds/live entries for the public API. */
function transformLiveOddsForClient(rawLiveOdds) {
  return (rawLiveOdds || []).map((entry) => {
    const fixtureId = entry.fixture?.id;
    const status = entry.fixture?.status || {};
    const teams = entry.teams || {};
    const odds = entry.odds || [];

    const markets = odds
      .filter((o) => o.name && Array.isArray(o.values) && o.values.length > 0)
      .map((o) => ({
        name: o.name,
        odd_lines: o.values
          .filter((v) => !v.suspended && v.odd)
          .map((v) => ({
            value: v.handicap ? `${v.value} ${v.handicap}` : v.value,
            odd: Number.parseFloat(v.odd),
          })),
      }))
      .filter((m) => m.odd_lines.length > 0);

    const apiId = Number(fixtureId);
    return {
      api_fixture_id: Number.isFinite(apiId) ? apiId : fixtureId,
      status: status.long || "Live",
      elapsed: status.elapsed,
      elapsed_seconds: status.seconds,
      home_score: teams.home?.goals ?? null,
      away_score: teams.away?.goals ?? null,
      league_id: entry.league?.id,
      markets,
    };
  });
}

// Main markets needed for the summary odds display (1/X/2/1X/X2/12)
const MAIN_MARKET_NAMES = [
  "Match Winner",
  "Double Chance",
  "Goals Over/Under",
  "Both Teams Score",
];

/**
 * Build a Prisma `include` clause for fixture.markets that optionally
 * filters odd_lines down to a single bookmaker. Markets with no matching
 * lines are dropped post-query so the UI doesn't render empty headers.
 *
 * @param {string|null} preferredBookmakerId - bookmaker ID to filter odd_lines
 * @param {object} options
 * @param {number} options.marketLimit - max markets to fetch
 * @param {number} options.oddLineLimit - max odd_lines per market
 * @param {boolean} options.mainMarketsOnly - only fetch Match Winner/Double Chance
 * @param {string[]} [options.marketNamesIn] - explicit market names (overrides mainMarketsOnly list when set)
 */
function buildMarketsInclude(
  preferredBookmakerId,
  { marketLimit, oddLineLimit, mainMarketsOnly, marketNamesIn } = {},
) {
  const oddLines = {
    where: preferredBookmakerId
      ? { bookmaker_id: preferredBookmakerId }
      : undefined,
    include: { bookmaker: true },
  };
  if (Number.isFinite(oddLineLimit) && oddLineLimit > 0) {
    oddLines.take = oddLineLimit;
    // Stable slice for list caps — without order, `take` can return arbitrary
    // rows and mismatched compact strip vs `/odds/:id` full markets.
    oddLines.orderBy = { value: "asc" };
  }

  const include = {
    include: { odd_lines: oddLines },
  };

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

/**
 * After a filtered Prisma query, strip markets whose `odd_lines` ended up
 * empty because the preferred bookmaker didn't price them. Mutates `fixture`
 * in place and returns it for chaining.
 */
function stripEmptyMarkets(fixture) {
  if (!fixture || !Array.isArray(fixture.markets)) return fixture;
  fixture.markets = fixture.markets.filter(
    (m) => Array.isArray(m.odd_lines) && m.odd_lines.length > 0,
  );
  return fixture;
}

/** Public list responses: omit fixtures with no priced lines after merge. */
function fixtureHasPricedOdds(fixture) {
  const markets = fixture?.markets;
  if (!Array.isArray(markets) || markets.length === 0) return false;
  return markets.some(
    (m) => Array.isArray(m.odd_lines) && m.odd_lines.length > 0,
  );
}

function isLegacyOnlyFixtureMarkets(markets) {
  if (!Array.isArray(markets) || markets.length === 0) return false;
  const uniqueNames = [
    ...new Set(markets.map((m) => String(m?.name || "").trim())),
  ].filter(Boolean);
  if (!uniqueNames.length) return false;
  if (uniqueNames.length > 4) return false;
  return uniqueNames.every((name) =>
    LEGACY_MARKET_PATTERNS.some((pattern) => pattern.test(name)),
  );
}

/**
 * PERF/ARCH: This function performs O(bookmakers × markets × values) Mongo
 * upserts and is invoked from the request path of `/odds/:apiFixtureId`
 * whenever a fixture has no markets yet. It's the single largest source
 * of CPU/IO on the API process today.
 *
 * TODO (out of scope for the safe pass): move this to a dedicated BullMQ
 * job (e.g. enqueue on `sync-odds` with a `{ apiFixtureId }` payload that
 * `processOdds` knows how to dispatch). The request handler should then
 * just enqueue and return whatever is currently in the DB – workers
 * remain the sole writers, the API stays read-only, and clients pick up
 * fresh data on the next refresh tick. Doing it now would change the
 * cold-start UX (a brand-new fixture would render with empty markets
 * until the worker finishes), so it warrants a dedicated PR with a
 * frontend story for the loading state.
 */
async function upsertParsedOddsForFixture(fixtureId, parsed) {
  for (const bk of parsed.bookmakers || []) {
    const bookmaker = await prisma.bookmaker.upsert({
      where: { api_bookmaker_id: bk.apiBookmakerId },
      update: { name: bk.name },
      create: { api_bookmaker_id: bk.apiBookmakerId, name: bk.name },
    });

    for (const mkt of bk.markets || []) {
      const market = await prisma.fixtureMarket.upsert({
        where: {
          fixture_id_name: {
            fixture_id: fixtureId,
            name: mkt.name,
          },
        },
        update: {},
        create: { name: mkt.name, fixture_id: fixtureId },
      });

      for (const v of mkt.values || []) {
        await prisma.fixtureOddLine.upsert({
          where: {
            market_id_bookmaker_id_value: {
              market_id: market.id,
              bookmaker_id: bookmaker.id,
              value: v.value,
            },
          },
          update: { odd: v.odd },
          create: {
            value: v.value,
            odd: v.odd,
            market_id: market.id,
            bookmaker_id: bookmaker.id,
          },
        });
      }
    }
  }

  await recomputeExtraMarketsCountForFixture(fixtureId);
}

/**
 * Per-fixture in-process single-flight for the hydration path of
 * `/odds/:apiFixtureId`. The frontend (useMatches) hydrates up to 12
 * fixtures in parallel on every 30s window refresh; without dedupe,
 * concurrent requests for the same cold fixture each ran the full
 * upstream + parse + upsert pipeline. This Map ensures only the first
 * caller does the work and the rest await the same promise.
 */
const oddsHydrationInflight = new Map();

function startEndUtcToday() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function startEndUtcWindow(days) {
  const safeDays = Math.max(1, Number(days) || 1);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + safeDays - 1);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Cache keys are namespaced by the preferred bookmaker so a preference
 * change doesn't poison data served to other sessions. `bk-all` is used
 * when no preference is set.
 */
function bookmakerCacheSuffix(preferredBookmaker) {
  if (!preferredBookmaker) return "bk-all";
  return `bk-${preferredBookmaker.api_bookmaker_id}`;
}

function fixturesListCacheModeSuffix() {
  return isPublicFixturesStrictBookmaker() ? "strict" : "relaxed";
}

/**
 * Preferred-bookmaker rows first; when relaxed mode and preferred is set,
 * fill fixtures missing markets using any bookmaker (same caps).
 */
async function mergeMarketsFallbackForList(rows, preferred, caps) {
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
      markets: buildMarketsInclude(null, caps),
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

function upcomingCutoffStart(baseStart) {
  const nowPlusBuffer = new Date(
    Date.now() + UPCOMING_MIN_START_BUFFER_MINUTES * 60 * 1000,
  );
  return baseStart > nowPlusBuffer ? baseStart : nowPlusBuffer;
}

function filterUpcomingByStartBuffer(fixtures) {
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

function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function parseUtcYmd(dateStr) {
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

/**
 * GET /fixtures?date=YYYY-MM-DD — prematch fixtures for one UTC calendar day
 * with minimal Match Winner + Double Chance odds only (list performance).
 */
router.get("/fixtures", async (req, res) => {
  try {
    const parsed = parseUtcYmd(req.query.date);
    if (!parsed) {
      return res.status(400).json({
        message: "Invalid or missing date query (expected date=YYYY-MM-DD UTC)",
      });
    }

    const preferred = await getPreferredBookmakerRecord();
    const cacheKey = `fixtures:by-date:${parsed.ymd}:${bookmakerCacheSuffix(preferred)}:${fixturesListCacheModeSuffix()}`;

    let data = await getCache(cacheKey);
    if (!data) {
      let rangeStart = parsed.start;
      const rangeEnd = parsed.end;
      if (parsed.ymd === utcTodayYmd()) {
        rangeStart = upcomingCutoffStart(parsed.start);
      }

      const rows = await prisma.fixture.findMany({
        where: {
          start_time: { gte: rangeStart, lte: rangeEnd },
          status: { in: [...UPCOMING_ALLOWED_STATUSES] },
        },
        include: {
          home_team: true,
          away_team: true,
          league: true,
          markets: buildMarketsInclude(preferred?.id, {
            marketLimit: FIXTURES_SUMMARY_MARKET_LIMIT,
            oddLineLimit: FIXTURES_SUMMARY_ODD_LINES_PER_MARKET,
            marketNamesIn: SUMMARY_MARKET_NAMES,
          }),
        },
        orderBy: { start_time: "asc" },
        take: UPCOMING_FIXTURES_LIMIT,
      });

      let merged = await mergeMarketsFallbackForList(rows, preferred, {
        marketLimit: FIXTURES_SUMMARY_MARKET_LIMIT,
        oddLineLimit: FIXTURES_SUMMARY_ODD_LINES_PER_MARKET,
        marketNamesIn: SUMMARY_MARKET_NAMES,
      });

      merged = merged.filter(fixtureHasPricedOdds);

      data = merged;
      await setCache(cacheKey, data, TTL.FIXTURES);
    }

    // For today, filter out fixtures that have already started (cache may be stale)
    if (parsed.ymd === utcTodayYmd()) {
      data = filterUpcomingByStartBuffer(data);
    }

    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load fixtures for date" });
  }
});

router.get("/leagues", async (_req, res) => {
  try {
    let data = await getCache("leagues:all");
    if (!data) {
      data = await prisma.league.findMany({
        where: { active: true },
        include: { sport: true },
      });
      await setCache("leagues:all", data, TTL.LEAGUES);
    }
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load leagues" });
  }
});

function leagueSidebarDisplayId(league) {
  const country = league?.country?.trim() || "Unknown";
  const name = league?.name?.trim() || "League";
  return `${country} - ${name}`;
}

router.get("/sidebar-leagues", async (_req, res) => {
  try {
    const horizonDays = getOddsHorizonDays();
    const cacheKey = `sidebar-leagues:v1:${horizonDays}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const allowedList = [...ALLOWED_LEAGUE_IDS];
    const { start, end } = startEndUtcWindow(horizonDays);

    const [upcomingRows, liveRows] = await Promise.all([
      prisma.fixture.findMany({
        where: {
          status: { in: [...UPCOMING_ALLOWED_STATUSES] },
          start_time: { gte: start, lte: end },
          league: { api_league_id: { in: allowedList } },
        },
        select: { league: { select: { api_league_id: true } } },
      }),
      prisma.fixture.findMany({
        where: {
          status: { in: LIVE_SIDEBAR_STATUSES },
          league: { api_league_id: { in: allowedList } },
        },
        select: { league: { select: { api_league_id: true } } },
      }),
    ]);

    const fromFixtures = new Set();
    for (const row of upcomingRows) {
      const id = row.league?.api_league_id;
      if (id != null && ALLOWED_LEAGUE_IDS.has(id)) fromFixtures.add(id);
    }
    for (const row of liveRows) {
      const id = row.league?.api_league_id;
      if (id != null && ALLOWED_LEAGUE_IDS.has(id)) fromFixtures.add(id);
    }

    const preferredList = [...PREFERRED_LEAGUE_IDS].filter((id) =>
      ALLOWED_LEAGUE_IDS.has(id),
    );
    const unionApiIds = [...new Set([...preferredList, ...fromFixtures])];

    const rows = await prisma.league.findMany({
      where: {
        active: true,
        api_league_id: { in: unionApiIds },
      },
    });

    const byApiId = new Map(
      rows.filter((r) => r.api_league_id != null).map((r) => [r.api_league_id, r]),
    );

    const pinnedOrder = new Map(
      preferredList.map((id, index) => [id, index]),
    );

    const items = [];
    for (const apiId of unionApiIds) {
      const row = byApiId.get(apiId);
      if (!row) continue;
      const pinned = PREFERRED_LEAGUE_IDS.has(apiId);
      const country = row.country?.trim() || "Unknown";
      items.push({
        id: leagueSidebarDisplayId(row),
        apiLeagueId: apiId,
        pinned,
        label: row.name?.trim() || "League",
        country,
        leagueLogo: row.logo ?? null,
        countryFlag: row.country_flag ?? null,
      });
    }

    items.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.pinned && b.pinned) {
        return (
          (pinnedOrder.get(a.apiLeagueId) ?? 999) -
          (pinnedOrder.get(b.apiLeagueId) ?? 999)
        );
      }
      return String(a.id).localeCompare(String(b.id));
    });

    const payload = { horizonDays, items };
    await setCache(cacheKey, payload, TTL.SIDEBAR_LEAGUES);
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load sidebar leagues" });
  }
});

router.get("/fixtures/today", async (_req, res) => {
  try {
    const preferred = await getPreferredBookmakerRecord();
    const cacheKey = `fixtures:today:${bookmakerCacheSuffix(preferred)}:${fixturesListCacheModeSuffix()}`;

    let data = await getCache(cacheKey);
    if (!data) {
      const { start, end } = startEndUtcToday();
      const rows = await prisma.fixture.findMany({
        where: { start_time: { gte: start, lte: end } },
        include: {
          home_team: true,
          away_team: true,
          league: true,
          markets: buildMarketsInclude(preferred?.id, {
            marketLimit: TODAY_MARKETS_PER_FIXTURE,
            oddLineLimit: TODAY_ODD_LINES_PER_MARKET,
          }),
        },
        orderBy: { start_time: "asc" },
      });

      let merged = await mergeMarketsFallbackForList(rows, preferred, {
        marketLimit: TODAY_MARKETS_PER_FIXTURE,
        oddLineLimit: TODAY_ODD_LINES_PER_MARKET,
      });

      merged = merged.filter(fixtureHasPricedOdds);

      data = merged;
      await setCache(cacheKey, data, TTL.FIXTURES);
    }
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load today's fixtures" });
  }
});

router.get("/fixtures/upcoming", async (req, res) => {
  try {
    const requestedDays = Number.parseInt(req.query.days, 10);
    const days = Number.isFinite(requestedDays)
      ? Math.min(Math.max(requestedDays, 1), UPCOMING_WINDOW_MAX_DAYS)
      : Math.min(
          Math.max(UPCOMING_WINDOW_DEFAULT_DAYS, 1),
          UPCOMING_WINDOW_MAX_DAYS,
        );

    const preferred = await getPreferredBookmakerRecord();
    const cacheKey = `fixtures:upcoming:${days}d:${bookmakerCacheSuffix(preferred)}:${fixturesListCacheModeSuffix()}`;

    let data = await getCache(cacheKey);
    if (!data) {
      const { start, end } = startEndUtcWindow(days);
      const effectiveStart = upcomingCutoffStart(start);
      const rows = await prisma.fixture.findMany({
        where: {
          start_time: { gte: effectiveStart, lte: end },
          status: { in: [...UPCOMING_ALLOWED_STATUSES] },
        },
        include: {
          home_team: true,
          away_team: true,
          league: true,
          markets: buildMarketsInclude(preferred?.id, {
            marketLimit: UPCOMING_MARKETS_PER_FIXTURE,
            oddLineLimit: UPCOMING_ODD_LINES_PER_MARKET,
            mainMarketsOnly: true,
          }),
        },
        orderBy: { start_time: "asc" },
        take: UPCOMING_FIXTURES_LIMIT,
      });

      let merged = await mergeMarketsFallbackForList(rows, preferred, {
        marketLimit: UPCOMING_MARKETS_PER_FIXTURE,
        oddLineLimit: UPCOMING_ODD_LINES_PER_MARKET,
        mainMarketsOnly: true,
      });

      merged = merged.filter(fixtureHasPricedOdds);

      data = merged;
      await setCache(cacheKey, data, TTL.FIXTURES);
    }
    res.json(filterUpcomingByStartBuffer(data));
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load upcoming fixtures" });
  }
});

// Short Redis-side cache for /fixtures/live so concurrent clients polling
// every 10s share the same DB result instead of each triggering a Mongo
// `findMany`. TTL is intentionally below the frontend poll interval so
// freshness is preserved.
const LIVE_FIXTURES_CACHE_TTL = Number(
  process.env.LIVE_FIXTURES_CACHE_TTL || 5,
);

router.get("/fixtures/live", async (_req, res) => {
  try {
    const cached = await getCache("live:fixtures:current");
    if (cached) {
      return res.json(cached);
    }

    let liveOdds;
    try {
      liveOdds = await getTransformedLiveOddsCoalesced();
    } catch (err) {
      console.error("[/fixtures/live] live odds upstream:", err);
      return res.json([]);
    }

    const allowedApiIds = [
      ...new Set(
        liveOdds
          .filter((o) => Array.isArray(o.markets) && o.markets.length > 0)
          .map((o) => o.api_fixture_id)
          .filter((id) => Number.isFinite(Number(id))),
      ),
    ];

    if (allowedApiIds.length === 0) {
      await setCache("live:fixtures:current", [], LIVE_FIXTURES_CACHE_TTL);
      return res.json([]);
    }

    const rows = await prisma.fixture.findMany({
      where: {
        status: { in: ["LIVE", "HT"] },
        api_fixture_id: { in: allowedApiIds },
      },
      take: LIVE_FIXTURES_LIMIT,
      include: {
        home_team: true,
        away_team: true,
        league: true,
      },
      orderBy: { start_time: "asc" },
    });

    await setCache("live:fixtures:current", rows, LIVE_FIXTURES_CACHE_TTL);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load live fixtures" });
  }
});

/**
 * Fetch live odds for all in-play fixtures from upstream.
 * Returns real-time elapsed time, scores, and odds in a single call.
 * Upstream + transform are coalesced in-process for ~LIVE_ODDS_COALESCE_MS
 * so concurrent clients share work without an extra Redis round-trip.
 */
router.get("/odds/live", async (_req, res) => {
  try {
    const liveOdds = await getTransformedLiveOddsCoalesced();
    res.json(liveOdds);
  } catch (e) {
    console.error("[/odds/live] error:", e);
    res.status(500).json({ message: "Failed to fetch live odds" });
  }
});

router.get("/odds/:apiFixtureId", async (req, res) => {
  try {
    const apiFixtureId = Number.parseInt(req.params.apiFixtureId, 10);
    if (Number.isNaN(apiFixtureId)) {
      return res.status(400).json({ message: "Invalid fixture id" });
    }

    const preferred = await getPreferredBookmakerRecord();
    const cacheKey = `odds:fixture:${apiFixtureId}:${bookmakerCacheSuffix(preferred)}:${fixturesListCacheModeSuffix()}`;

    let data = await getCache(cacheKey);
    if (
      data &&
      (!Array.isArray(data.markets) ||
        data.markets.length === 0 ||
        isLegacyOnlyFixtureMarkets(data.markets))
    ) {
      data = null;
    }

    if (!data) {
      let fixture = await prisma.fixture.findUnique({
        where: { api_fixture_id: apiFixtureId },
        include: {
          league: { include: { sport: true } },
          markets: buildMarketsInclude(preferred?.id),
        },
      });
      if (!fixture) {
        return res.status(404).json({ message: "Fixture not found" });
      }

      // On-demand hydration: if nothing was persisted yet (or the preferred
      // bookmaker hasn't priced this fixture at all), fetch the full odds
      // blob from upstream and persist. We re-query with the filter after
      // so clients always see bookmaker-scoped data.
      //
      // SAFE-PASS: routed through `oddsHydrationInflight` so that 12
      // simultaneous requests for the same cold fixture (typical when
      // useMatches hydrates a window) don't each pay the full
      // upstream + parse + upsert cost. Long-term this should move to a
      // worker (see comment on `upsertParsedOddsForFixture`).
      const hasAnyMarkets = stripEmptyMarkets(fixture).markets.length > 0;
      const shouldRefreshLegacyMarkets =
        hasAnyMarkets && isLegacyOnlyFixtureMarkets(fixture.markets);
      if (!hasAnyMarkets || shouldRefreshLegacyMarkets) {
        const inflightKey = `${apiFixtureId}:${preferred?.api_bookmaker_id ?? "all"}`;
        let hydrationPromise = oddsHydrationInflight.get(inflightKey);
        if (!hydrationPromise) {
          hydrationPromise = (async () => {
            const sportSlug = fixture.league?.sport?.slug || "football";
            const rawOdds = await api(sportSlug).getOdds(apiFixtureId);
            if (!rawOdds.length) return;

            // On-demand hydration must honor the same single-bookmaker /
            // market allowlist policy as the background sync jobs so we
            // don't reintroduce write amplification through this path.
            const parseOptions = buildOddsParseOptions(
              preferred?.api_bookmaker_id ?? null,
            );
            const parsed = parseMarkets(rawOdds, parseOptions);
            await upsertParsedOddsForFixture(fixture.id, parsed);
            await deleteByPattern("fixtures:today:*");
            await deleteByPattern("fixtures:by-date:*");
            await deleteByPattern("fixtures:upcoming:*");
            await deleteByPattern("live:fixtures:*");
          })().finally(() => {
            oddsHydrationInflight.delete(inflightKey);
          });
          oddsHydrationInflight.set(inflightKey, hydrationPromise);
        }

        await hydrationPromise;

        fixture = await prisma.fixture.findUnique({
          where: { api_fixture_id: apiFixtureId },
          include: {
            league: { include: { sport: true } },
            markets: buildMarketsInclude(preferred?.id),
          },
        });
        stripEmptyMarkets(fixture);
      }

      data = fixture;

      if (
        preferred?.id &&
        !isPublicFixturesStrictBookmaker() &&
        (!Array.isArray(data?.markets) || data.markets.length === 0)
      ) {
        const loose = await prisma.fixture.findUnique({
          where: { api_fixture_id: apiFixtureId },
          include: {
            league: { include: { sport: true } },
            markets: buildMarketsInclude(null, {
              marketLimit: TODAY_MARKETS_PER_FIXTURE,
              oddLineLimit: TODAY_ODD_LINES_PER_MARKET,
            }),
          },
        });
        if (loose) {
          stripEmptyMarkets(loose);
          if (loose.markets?.length) {
            data = loose;
          }
        }
      }

      if (Array.isArray(data?.markets) && data.markets.length > 0) {
        await setCache(cacheKey, data, TTL.ODDS);
      }
    }
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load odds" });
  }
});

router.get("/_debug/cache", async (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ message: "Not found" });
  }

  const prefix = process.env.REDIS_KEY_PREFIX
    ? `${process.env.REDIS_KEY_PREFIX}:`
    : "";

  try {
    const redis = getRedisClient();
    const scan = redis.scanStream({
      match: `${prefix}*`,
      count: CACHE_SCAN_COUNT,
    });

    const totals = {
      all: 0,
      apisports: 0,
      leagues: 0,
      fixtures: 0,
      odds: 0,
      live: 0,
      bootstrap: 0,
      settings: 0,
      other: 0,
    };

    for await (const keys of scan) {
      for (const key of keys) {
        const stripped = prefix ? key.replace(prefix, "") : key;
        totals.all++;
        if (stripped.startsWith("apisports:")) totals.apisports++;
        else if (stripped.startsWith("leagues:")) totals.leagues++;
        else if (stripped.startsWith("fixtures:")) totals.fixtures++;
        else if (stripped.startsWith("odds:")) totals.odds++;
        else if (stripped.startsWith("live:")) totals.live++;
        else if (stripped.startsWith("bootstrap:")) totals.bootstrap++;
        else if (stripped.startsWith("settings:")) totals.settings++;
        else totals.other++;
      }
    }

    res.json({
      keyPrefix: prefix,
      scanCount: CACHE_SCAN_COUNT,
      totals,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to inspect cache" });
  }
});

router.get("/_debug/upstream-usage", (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ message: "Not found" });
  }
  res.json({
    sport: "football",
    dailyCalls: getDailyCallCount("football"),
    dailyLimit: Number(process.env.API_SPORTS_DAILY_LIMIT || 75000),
  });
});

/**
 * Per-queue health snapshot. Mirrors what BullMQ's UI would show but without
 * pulling in the dashboard package. Dev-only.
 */
router.get("/_debug/queues", async (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ message: "Not found" });
  }

  try {
    const queues = getAllQueues();
    const snapshot = await Promise.all(
      queues.map(async (q) => {
        const counts = await q.getJobCounts(
          "waiting",
          "active",
          "delayed",
          "completed",
          "failed",
          "paused",
        );
        const repeatables = await q.getRepeatableJobs();
        return {
          name: q.name,
          counts,
          repeatables: repeatables.map((r) => ({
            id: r.id,
            name: r.name,
            every: r.every,
            cron: r.cron,
            next: r.next,
          })),
        };
      }),
    );
    res.json({ queues: snapshot, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to inspect queues" });
  }
});

export default router;
