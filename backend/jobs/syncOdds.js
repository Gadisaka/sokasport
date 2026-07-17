import prisma from "../Config/db.js";
import { api, sleep } from "../services/apiSportsService.js";
import {
  deleteByPattern,
  getCache,
} from "../services/cacheService.js";
import { refreshFixturesByDateCaches } from "../services/fixturesListService.js";
import { parseMarkets } from "../utils/oddsParser.js";
import { getEnabledSports } from "../services/sportsRegistry.js";
import { getPreferredBookmakerApiId } from "../services/settingsService.js";
import {
  ALLOWED_MARKETS,
  buildOddsParseOptions,
} from "../Config/oddsFilters.js";
import {
  getOddsHorizonDays,
  getOddsNearPriorityDays,
  getOddsNearPriorityEndUtc,
} from "../Config/ingestionConfig.js";
import { sortFixturesForOddsIngest } from "../Config/leagueTiers.js";
import { tryConsumeOddsApiBudget } from "../services/apiBudget.js";
import {
  markFixtureOddsChecked,
  persistParsedOddsForFixture,
  RAW_ODDS_CACHE_VERSION,
} from "./lib/persistOdds.js";

/**
 * Odds ingestion job.
 *
 * Concurrency is owned by the BullMQ queue (`sync-odds`, concurrency=1).
 * Accepts options from job.data to support both repeatable ticks and
 * post-fixture-bulk backfills that cover the full horizon.
 *
 * Modes:
 *   - "missing_first" (default): prioritize NS fixtures with no markets,
 *     then fill remaining capacity with LIVE/HT or NS that already have
 *     markets (for refresh).
 *   - "all_in_horizon": process all fixtures in order (legacy behavior
 *     with the slice cap still applied as safety).
 *
 * Prematch selection only includes fixtures that are due
 * (`next_odds_check_at` null or <= now) so adaptive recheck delays free
 * the per-run slot budget for fixtures that can actually be priced.
 */

const ODDS_CALL_DELAY_MS = 500;

const DEFAULT_MAX_FIXTURES_PER_RUN = Number(
  process.env.ODDS_MAX_FIXTURES_PER_RUN || 250,
);
const BACKFILL_MAX_FIXTURES = Number(
  process.env.ODDS_HORIZON_BACKFILL_MAX || 500,
);

/** Overshoot fetch then stable-sort so league tiers / near-window ordering apply before maxFixtures cap. */
function overshootTake(remaining) {
  const r = Math.max(1, remaining);
  return Math.min(Math.max(r * 8, r + 50), 2500);
}

/** Same UTC calendar window as footballPublic / syncFixtures. */
function startEndUtcWindow(days) {
  const safeDays = Math.max(1, Number(days) || 1);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + safeDays - 1);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/** Prematch fixtures due for an odds attempt (null = never checked / legacy). */
function dueOddsCheckWhere(now = new Date()) {
  return {
    OR: [{ next_odds_check_at: null }, { next_odds_check_at: { lte: now } }],
  };
}

/**
 * @param {object} options
 * @param {number} [options.horizonDays] - days ahead to cover (default getOddsHorizonDays())
 * @param {number} [options.maxFixtures] - cap on fixtures processed this run
 * @param {"missing_first"|"all_in_horizon"} [options.mode] - prioritization strategy
 * @param {boolean} [options.skipNearPriority] - when true, ignore ODDS_NEAR_PRIORITY_DAYS and process chronologically
 * @param {string} [options.label] - label for logging
 */
export default async function syncOdds(options = {}) {
  const horizonDays =
    Number(options.horizonDays) > 0
      ? Math.floor(Number(options.horizonDays))
      : getOddsHorizonDays();
  const mode = options.mode || "missing_first";
  const isBackfill = options.label?.includes("backfill");
  const skipNearPriority = Boolean(options.skipNearPriority);
  const maxFixtures = Number(options.maxFixtures) ||
    (isBackfill ? BACKFILL_MAX_FIXTURES : DEFAULT_MAX_FIXTURES_PER_RUN);
  const label = options.label || `tick-${horizonDays}d`;

  console.log(
    `[syncOdds] starting (${label}, horizon=${horizonDays}d, max=${maxFixtures}, mode=${mode}, skipNearPriority=${skipNearPriority})`,
  );

  try {
    const enabled = getEnabledSports();
    if (!enabled.length) {
      console.warn("[syncOdds] no enabled sports – nothing to do");
      return { checked: 0, upserts: 0 };
    }

    const preferredApiId = await getPreferredBookmakerApiId();
    const parseOptions = buildOddsParseOptions(preferredApiId);
    if (parseOptions.legacyPersistAllBookmakers) {
      console.warn(
        "[syncOdds] no preferred bookmaker AND no DEFAULT_BOOKMAKER_API_ID / BOOKMAKER_FALLBACK_CHAIN – persisting all bookmakers (legacy behavior). Set admin preference or env defaults to reduce write volume.",
      );
    } else {
      console.log(
        `[syncOdds] bookmaker priority=${parseOptions.orderedBookmakerApiIds?.join(">") ?? "—"}` +
          (parseOptions.anyBookmakerFallthrough ? ">+any" : "") +
          (ALLOWED_MARKETS
            ? `, markets=${[...ALLOWED_MARKETS].join("|")}`
            : ", markets=all"),
      );
    }

    const nearDays = skipNearPriority ? null : getOddsNearPriorityDays();
    const nearPriorityEnd =
      nearDays != null ? getOddsNearPriorityEndUtc(nearDays) : null;

    const now = new Date();
    const { start, end } = startEndUtcWindow(horizonDays);
    const dueWhere = dueOddsCheckWhere(now);
    const baseWhere = {
      start_time: { gte: start, lte: end },
      league: { sport: { slug: { in: enabled } } },
    };
    const selectFields = {
      id: true,
      api_fixture_id: true,
      status: true,
      start_time: true,
      league: {
        select: {
          api_league_id: true,
          sport: { select: { slug: true } },
        },
      },
    };

    /** Sort & cap — tiers / optional near-window bucket apply before workload slicing. */
    function sortAndTake(rows, limit) {
      const sorted = sortFixturesForOddsIngest(rows, { nearPriorityEnd });
      return sorted.slice(0, Math.max(0, limit));
    }

    let fixtures = [];

    if (mode === "missing_first") {
      const missingRaw = await prisma.fixture.findMany({
        where: {
          ...baseWhere,
          ...dueWhere,
          status: "NS",
          markets: { none: {} },
        },
        orderBy: { start_time: "asc" },
        take: overshootTake(maxFixtures),
        select: selectFields,
      });
      fixtures.push(...sortAndTake(missingRaw, maxFixtures));

      if (fixtures.length < maxFixtures) {
        const rem = maxFixtures - fixtures.length;
        // LIVE/HT always refresh — eligibility gate does not apply.
        const liveHtRaw = await prisma.fixture.findMany({
          where: {
            ...baseWhere,
            status: { in: ["LIVE", "HT"] },
          },
          orderBy: { start_time: "asc" },
          take: overshootTake(rem),
          select: selectFields,
        });
        const picked = sortAndTake(liveHtRaw, rem);
        const existingIds = new Set(fixtures.map((f) => f.id));
        for (const f of picked) {
          if (!existingIds.has(f.id)) fixtures.push(f);
        }
      }

      if (fixtures.length < maxFixtures) {
        const rem = maxFixtures - fixtures.length;
        const existingIds = new Set(fixtures.map((f) => f.id));
        const nsWithRaw = await prisma.fixture.findMany({
          where: {
            ...baseWhere,
            ...dueWhere,
            status: "NS",
            markets: { some: {} },
          },
          orderBy: { start_time: "asc" },
          take: overshootTake(rem),
          select: selectFields,
        });
        const sortedNs = sortFixturesForOddsIngest(nsWithRaw, {
          nearPriorityEnd,
        });
        for (const f of sortedNs) {
          if (!existingIds.has(f.id) && fixtures.length < maxFixtures) {
            fixtures.push(f);
            existingIds.add(f.id);
          }
        }
      }
    } else {
      const raw = await prisma.fixture.findMany({
        where: {
          ...baseWhere,
          OR: [
            { status: { in: ["LIVE", "HT"] } },
            {
              AND: [{ status: "NS" }, dueWhere],
            },
          ],
        },
        orderBy: { start_time: "asc" },
        take: overshootTake(maxFixtures),
        select: selectFields,
      });
      fixtures = sortAndTake(raw, maxFixtures);
    }

    console.log(
      `[syncOdds] fixtures to process: ${fixtures.length} (mode=${mode})`,
    );

    let total = 0;
    let checked = 0;
    let skippedCached = 0;
    let skippedNoSport = 0;
    let skippedNoOdds = 0;
    let skippedBudget = 0;
    let stoppedForBudget = false;

    for (const fixture of fixtures) {
      checked++;
      const sportSlug = fixture.league?.sport?.slug;
      if (!sportSlug) {
        skippedNoSport++;
        continue;
      }

      const cacheKey = `odds:fixture:${fixture.api_fixture_id}:raw:v${RAW_ODDS_CACHE_VERSION}`;

      // For LIVE/HT, always refresh (skip cache check)
      const isLiveOrHt = fixture.status === "LIVE" || fixture.status === "HT";
      if (!isLiveOrHt) {
        const cached = await getCache(cacheKey);
        const hasUsefulCachedOdds = Boolean(
          (Array.isArray(cached?.bookmakers) && cached.bookmakers.length > 0) ||
          (Array.isArray(cached?.markets) && cached.markets.length > 0),
        );
        if (hasUsefulCachedOdds) {
          skippedCached++;
          // Keep selection slots free until the next adaptive window.
          await markFixtureOddsChecked(fixture).catch(() => {});
          if (checked % 50 === 0 || checked === fixtures.length) {
            console.log(
              `[syncOdds] progress ${checked}/${fixtures.length} – cached=${skippedCached}, upserts=${total}`,
            );
          }
          continue;
        }
      }

      const budget = await tryConsumeOddsApiBudget(1);
      if (!budget.allowed) {
        skippedBudget++;
        stoppedForBudget = true;
        console.warn(
          `[syncOdds] daily odds API budget exhausted (used=${budget.used}/${budget.budget}) – stopping run`,
        );
        break;
      }

      const rawOdds = await api(sportSlug).getOdds(fixture.api_fixture_id);
      if (!rawOdds.length) {
        skippedNoOdds++;
        await markFixtureOddsChecked(fixture).catch(() => {});
        if (checked % 50 === 0 || checked === fixtures.length) {
          console.log(
            `[syncOdds] progress ${checked}/${fixtures.length} – noOdds=${skippedNoOdds}, upserts=${total}`,
          );
        }
        await sleep(ODDS_CALL_DELAY_MS);
        continue;
      }

      const parsed = parseMarkets(rawOdds, parseOptions);

      if (!parsed.bookmakers.length) {
        skippedNoOdds++;
        await markFixtureOddsChecked(fixture).catch(() => {});
        if (checked % 50 === 0 || checked === fixtures.length) {
          console.log(
            `[syncOdds] progress ${checked}/${fixtures.length} – noOdds=${skippedNoOdds}, upserts=${total}`,
          );
        }
        await sleep(ODDS_CALL_DELAY_MS);
        continue;
      }

      if (process.env.DEBUG_SYNC_ODDS === "1") {
        console.log(
          `[syncOdds] fixture=${fixture.api_fixture_id} winning_bookmaker=${parsed.bookmakers[0]?.apiBookmakerId}`,
        );
      }

      total += await persistParsedOddsForFixture(fixture, parsed);

      if (checked % 50 === 0 || checked === fixtures.length) {
        console.log(
          `[syncOdds] progress ${checked}/${fixtures.length} – cached=${skippedCached}, noOdds=${skippedNoOdds}, upserts=${total}`,
        );
      }
      await sleep(ODDS_CALL_DELAY_MS);
    }

    await deleteByPattern("fixtures:today:*");
    await deleteByPattern("fixtures:upcoming:*");
    await deleteByPattern("live:fixtures:*");
    if (total > 0) {
      await deleteByPattern("odds:fixture:*:bk-*");
      try {
        const refreshed = await refreshFixturesByDateCaches();
        console.log(
          `[syncOdds] fixtures by-date refreshed:`,
          refreshed.map((r) => `${r.ymd}=${r.count ?? r.error}`).join(", "),
        );
      } catch (err) {
        console.error(
          "[syncOdds] fixtures by-date refresh failed:",
          err?.message || err,
        );
      }
    } else {
      console.log(
        "[syncOdds] skip fixtures by-date refresh (no odds upserts)",
      );
    }

    console.log(
      `[syncOdds] done (${label}) – checked=${checked}, upserts=${total}, cached=${skippedCached}, noSport=${skippedNoSport}, noOdds=${skippedNoOdds}, budgetSkip=${skippedBudget}${stoppedForBudget ? " (budget-stop)" : ""}`,
    );

    return {
      label,
      checked,
      upserts: total,
      skippedCached,
      skippedNoSport,
      skippedNoOdds,
      skippedBudget,
      stoppedForBudget,
    };
  } catch (err) {
    console.error("[syncOdds] error:", err);
    throw err;
  }
}
