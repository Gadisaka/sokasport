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
import { isProviderMarketNameAllowed } from "../services/markets/marketSupport.js";
import { getDailyCallCount } from "../services/apiSportsService.js";
import { getPreferredBookmakerRecord } from "../services/settingsService.js";
import { getAllQueues } from "../queues/queues.js";
import { buildOddsParseOptions } from "../Config/oddsFilters.js";
import {
  getOddsHorizonDays,
  isPublicFixturesStrictBookmaker,
} from "../Config/ingestionConfig.js";
import {
  getLeagueRank,
  getSidebarActiveCap,
  isTopLeague,
  pickTopActiveLeagues,
} from "../Config/leagueRanks.js";
import { writeLiveOddsFromApiResponse } from "../services/liveOddsCache.js";
import { persistParsedOddsForFixture } from "../jobs/syncOdds.js";
import {
  attachLeagueRanksToList,
  bookmakerCacheSuffix,
  buildMarketsInclude,
  filterUpcomingByStartBuffer,
  fixtureHasPricedOdds,
  fixturesListCacheModeSuffix,
  getOrBuildFixturesByDate,
  mergeMarketsFallbackForList,
  parseUtcYmd,
  refreshFixturesByDateCaches,
  sortFixturesByLeagueRank,
  stripEmptyMarkets,
  upcomingCutoffStart,
  utcTodayYmd,
} from "../services/fixturesListService.js";

const router = Router();
const CACHE_SCAN_COUNT = 200;
const LIVE_FIXTURES_LIMIT = Number(process.env.LIVE_FIXTURES_LIMIT || 120);
const TODAY_MARKETS_PER_FIXTURE = Number(
  process.env.TODAY_MARKETS_PER_FIXTURE || 16,
);
const TODAY_ODD_LINES_PER_MARKET = Number(
  process.env.TODAY_ODD_LINES_PER_MARKET || 120,
);
/** Caps for GET /odds/:id expand payload (warm DB read + cold hydrate response). */
const ODDS_DETAIL_MARKET_LIMIT = Number(
  process.env.ODDS_DETAIL_MARKET_LIMIT || 24,
);
const ODDS_DETAIL_ODD_LINE_LIMIT = Number(
  process.env.ODDS_DETAIL_ODD_LINE_LIMIT || 80,
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
    .then(async (raw) => {
      // Reset transformed cache when raw changes – it will be lazily
      // rebuilt by the next call to `getTransformedLiveOddsCoalesced`.
      liveOddsSnapshot = { at: Date.now(), raw: raw ?? [], transformed: null };

      // Write live odds to Redis for bet validation to use
      if (raw?.length) {
        writeLiveOddsFromApiResponse(raw).catch((err) => {
          console.error("[getRawLiveOddsCoalesced] Redis write failed:", err);
        });
      }

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
      // Settlement gate: only serve live markets whose name is allowlisted.
      // Today none are (live id->code map not yet shipped) → live markets are
      // hidden until Phase 4, which is the correct, safe behavior.
      .filter((o) => isProviderMarketNameAllowed(o.name))
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

/**
 * Drop markets whose provider name is not in the allowed phase.
 * Returns a shallow copy so cached objects are not mutated.
 */
function dropUnsupportedMarkets(fixture) {
  if (!fixture || !Array.isArray(fixture.markets)) return fixture;
  const markets = fixture.markets.filter((m) =>
    isProviderMarketNameAllowed(m?.name),
  );
  return { ...fixture, markets };
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

/** Slim Prisma include for expand detail — capped, no bookmaker join (FE unused). */
function detailMarketsInclude(bookmakerId) {
  return buildMarketsInclude(bookmakerId, {
    marketLimit: ODDS_DETAIL_MARKET_LIMIT,
    oddLineLimit: ODDS_DETAIL_ODD_LINE_LIMIT,
    includeBookmaker: false,
  });
}

/**
 * Map parseMarkets() output onto a fixture row so expand can respond before
 * Mongo upserts finish. Shape matches what applyOddsToMatch expects.
 */
function attachParsedMarketsToFixture(fixture, parsed) {
  const bk = parsed?.bookmakers?.[0];
  if (!bk) {
    return { ...fixture, markets: [] };
  }

  const markets = (bk.markets || [])
    .slice(0, ODDS_DETAIL_MARKET_LIMIT)
    .map((mkt) => ({
      name: mkt.name,
      odd_lines: (mkt.values || [])
        .slice(0, ODDS_DETAIL_ODD_LINE_LIMIT)
        .map((v) => ({
          value: v.value,
          odd: v.odd,
        }))
        .filter(
          (line) =>
            String(line.value || "").trim().length > 0 &&
            Number.isFinite(Number(line.odd)) &&
            Number(line.odd) > 0,
        ),
    }))
    .filter((m) => Array.isArray(m.odd_lines) && m.odd_lines.length > 0);

  return { ...fixture, markets };
}

/** Fire-and-forget list cache invalidation + warm rebuild (must not block expand). */
function scheduleListCacheRefreshAfterOddsWrite() {
  void (async () => {
    try {
      await deleteByPattern("fixtures:today:*");
      await deleteByPattern("fixtures:upcoming:*");
      await deleteByPattern("live:fixtures:*");
    } catch (err) {
      console.error(
        "[odds hydration] list cache delete failed:",
        err?.message || err,
      );
    }
    try {
      await refreshFixturesByDateCaches();
    } catch (err) {
      console.error(
        "[odds hydration] fixtures by-date refresh failed:",
        err?.message || err,
      );
    }
  })();
}

/**
 * Persist hydrated odds off the request path. Uses the shared syncOdds helper
 * (same write semantics as background ingest).
 */
function schedulePersistParsedOdds(fixture, parsed) {
  void (async () => {
    try {
      await persistParsedOddsForFixture(fixture, parsed);
      scheduleListCacheRefreshAfterOddsWrite();
    } catch (err) {
      console.error(
        `[odds hydration] background persist failed fixture=${fixture?.api_fixture_id}:`,
        err?.message || err,
      );
    }
  })();
}

/**
 * Per-fixture in-process single-flight for the hydration path of
 * `/odds/:apiFixtureId`. Concurrent expands of the same cold fixture share
 * one upstream+parse; Mongo upserts run in the background after respond.
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
 * Bookmaker id for list queries: relaxed mode loads any persisted markets
 * (odds sync stores one bookmaker per fixture) to avoid a second fallback query.
 */
function listQueryBookmakerId(preferred) {
  if (isPublicFixturesStrictBookmaker()) {
    return preferred?.id ?? null;
  }
  return null;
}

/**
 * GET /fixtures?date=YYYY-MM-DD — prematch fixtures for one UTC calendar day
 * with minimal Match Winner + Double Chance odds only (list performance).
 * Cache rebuild is coalesced in fixturesListService (single-flight).
 */
router.get("/fixtures", async (req, res) => {
  try {
    const parsed = parseUtcYmd(req.query.date);
    if (!parsed) {
      return res.status(400).json({
        message: "Invalid or missing date query (expected date=YYYY-MM-DD UTC)",
      });
    }

    let data = await getOrBuildFixturesByDate(parsed.ymd);

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
    const sidebarCap = getSidebarActiveCap();
    const cacheKey = `sidebar-leagues:v2:${horizonDays}:${sidebarCap}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const { start, end } = startEndUtcWindow(horizonDays);
    const effectiveStart = upcomingCutoffStart(start);

    const [upcomingRows, liveRows] = await Promise.all([
      prisma.fixture.findMany({
        where: {
          status: { in: [...UPCOMING_ALLOWED_STATUSES] },
          start_time: { gte: effectiveStart, lte: end },
        },
        select: { league: { select: { api_league_id: true } } },
      }),
      prisma.fixture.findMany({
        where: {
          status: { in: LIVE_SIDEBAR_STATUSES },
        },
        select: { league: { select: { api_league_id: true } } },
      }),
    ]);

    const activeIds = new Set();
    for (const row of upcomingRows) {
      const id = row.league?.api_league_id;
      if (id != null) activeIds.add(id);
    }
    for (const row of liveRows) {
      const id = row.league?.api_league_id;
      if (id != null) activeIds.add(id);
    }

    const topActive = [...activeIds].filter((id) => isTopLeague(id));
    const regionalCandidates = [...activeIds].filter((id) => !isTopLeague(id));
    const regionalPicked = pickTopActiveLeagues(regionalCandidates, sidebarCap);
    const catalogApiIds = [...new Set([...topActive, ...regionalPicked])];

    const rows = await prisma.league.findMany({
      where: {
        active: true,
        api_league_id: { in: catalogApiIds },
      },
    });

    const byApiId = new Map(
      rows.filter((r) => r.api_league_id != null).map((r) => [r.api_league_id, r]),
    );

    const items = [];
    for (const apiId of catalogApiIds) {
      const row = byApiId.get(apiId);
      if (!row) continue;
      const country = row.country?.trim() || "Unknown";
      const rank = getLeagueRank(apiId);
      const section = isTopLeague(apiId) ? "top" : "regional";
      items.push({
        id: leagueSidebarDisplayId(row),
        apiLeagueId: apiId,
        pinned: section === "top",
        label: row.name?.trim() || "League",
        country,
        leagueLogo: row.logo ?? null,
        countryFlag: row.country_flag ?? null,
        rank,
        section,
      });
    }

    items.sort((a, b) => {
      if (a.section === "top" && b.section !== "top") return -1;
      if (a.section !== "top" && b.section === "top") return 1;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return String(a.label).localeCompare(String(b.label));
    });

    const payload = { horizonDays, sidebarCap, items };
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
    const cacheKey = `fixtures:today:v4:${bookmakerCacheSuffix(preferred)}:${fixturesListCacheModeSuffix()}`;

    let data = await getCache(cacheKey);
    if (!data) {
      const { start, end } = startEndUtcToday();
      const caps = {
        marketLimit: TODAY_MARKETS_PER_FIXTURE,
        oddLineLimit: TODAY_ODD_LINES_PER_MARKET,
      };
      const rows = await prisma.fixture.findMany({
        where: { start_time: { gte: start, lte: end } },
        include: {
          home_team: true,
          away_team: true,
          league: true,
          markets: buildMarketsInclude(listQueryBookmakerId(preferred), caps),
        },
        orderBy: { start_time: "asc" },
      });

      let merged = await mergeMarketsFallbackForList(rows, preferred, caps);

      merged = merged.filter(fixtureHasPricedOdds);
      merged = sortFixturesByLeagueRank(merged);

      data = attachLeagueRanksToList(merged);
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
    const cacheKey = `fixtures:upcoming:v4:${days}d:${bookmakerCacheSuffix(preferred)}:${fixturesListCacheModeSuffix()}`;

    let data = await getCache(cacheKey);
    if (!data) {
      const { start, end } = startEndUtcWindow(days);
      const effectiveStart = upcomingCutoffStart(start);
      const caps = {
        marketLimit: UPCOMING_MARKETS_PER_FIXTURE,
        oddLineLimit: UPCOMING_ODD_LINES_PER_MARKET,
        mainMarketsOnly: true,
      };
      const rows = await prisma.fixture.findMany({
        where: {
          start_time: { gte: effectiveStart, lte: end },
          status: { in: [...UPCOMING_ALLOWED_STATUSES] },
        },
        include: {
          home_team: true,
          away_team: true,
          league: true,
          markets: buildMarketsInclude(listQueryBookmakerId(preferred), caps),
        },
        orderBy: { start_time: "asc" },
      });

      let merged = await mergeMarketsFallbackForList(rows, preferred, caps);

      merged = merged.filter(fixtureHasPricedOdds);
      merged = sortFixturesByLeagueRank(merged, UPCOMING_FIXTURES_LIMIT);

      data = attachLeagueRanksToList(merged);
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
    const liveCacheKey = "live:fixtures:current:v3";
    const cached = await getCache(liveCacheKey);
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
      await setCache(liveCacheKey, [], LIVE_FIXTURES_CACHE_TTL);
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

    const payload = attachLeagueRanksToList(sortFixturesByLeagueRank(rows));
    await setCache(liveCacheKey, payload, LIVE_FIXTURES_CACHE_TTL);
    res.json(payload);
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
    // Suffix market cap so raising ODDS_DETAIL_MARKET_LIMIT busts stale fat caches.
    const cacheKey = `odds:fixture:${apiFixtureId}:${bookmakerCacheSuffix(preferred)}:${fixturesListCacheModeSuffix()}:m${ODDS_DETAIL_MARKET_LIMIT}`;

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
          markets: detailMarketsInclude(preferred?.id),
        },
      });
      if (!fixture) {
        return res.status(404).json({ message: "Fixture not found" });
      }

      // On-demand hydration: cold / legacy-only fixtures fetch upstream once
      // (single-flight), return parsed markets immediately, and persist to
      // Mongo in the background so expand does not wait on upsert amplification.
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
            if (!rawOdds.length) return null;

            const parseOptions = buildOddsParseOptions(
              preferred?.api_bookmaker_id ?? null,
            );
            const parsed = parseMarkets(rawOdds, parseOptions);
            if (!parsed?.bookmakers?.length) return null;

            const responseFixture = attachParsedMarketsToFixture(
              fixture,
              parsed,
            );
            stripEmptyMarkets(responseFixture);

            // Persist off the critical path — expand waits on upstream+parse only.
            schedulePersistParsedOdds(fixture, parsed);

            return responseFixture;
          })().finally(() => {
            oddsHydrationInflight.delete(inflightKey);
          });
          oddsHydrationInflight.set(inflightKey, hydrationPromise);
        }

        const hydrated = await hydrationPromise;
        if (hydrated?.markets?.length) {
          fixture = hydrated;
        } else {
          // Upstream empty / parse miss — re-read DB (may still be empty).
          fixture = await prisma.fixture.findUnique({
            where: { api_fixture_id: apiFixtureId },
            include: {
              league: { include: { sport: true } },
              markets: detailMarketsInclude(preferred?.id),
            },
          });
          stripEmptyMarkets(fixture);
        }
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
            markets: detailMarketsInclude(null),
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
    // Settlement gate: never serve an unsupported/mis-mapped market to a client.
    // Applied AFTER cache read/write so both fresh and cached responses are gated.
    res.json(dropUnsupportedMarkets(data));
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
