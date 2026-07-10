import prisma from "../Config/db.js";
import { api, sleep } from "../services/apiSportsService.js";
import {
  deleteByPattern,
  deleteCache,
} from "../services/cacheService.js";
import { parseMarkets } from "../utils/oddsParser.js";
import { getEnabledSports } from "../services/sportsRegistry.js";
import { getPreferredBookmakerApiId } from "../services/settingsService.js";
import {
  ALLOWED_MARKETS,
  buildOddsParseOptions,
} from "../Config/oddsFilters.js";
import {
  getOddsBulkMaxPagesPerDate,
  getOddsBulkPageDelayMs,
  getOddsHorizonDays,
} from "../Config/ingestionConfig.js";
import { refreshFixturesByDateCaches } from "../services/fixturesListService.js";
import { offsetsToDates } from "./syncFixtures.js";
import { persistParsedOddsForFixture } from "./syncOdds.js";

/**
 * Bulk odds ingest via API-Sports `GET /odds?date=YYYY-MM-DD` (paginated).
 *
 * Covers the full odds horizon in a few hundred calls instead of one call
 * per fixture. Only persists odds for fixtures already in Mongo that have
 * no markets yet (missing-only) — the league rank gate from fixture ingest
 * is preserved because unknown / non-ingested fixtures are skipped.
 *
 * The 2-minute per-fixture tick still refreshes near/live fixtures.
 */

function parseUtcYmdBounds(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const start = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
  return { start, end };
}

/**
 * Walk every page of `/odds?date=` for one sport/date.
 * @returns {Promise<{ byApiId: Map<number, object>, pages: number, items: number }>}
 */
async function fetchOddsPagesForDate(sportSlug, date) {
  const maxPages = getOddsBulkMaxPagesPerDate();
  const pageDelayMs = getOddsBulkPageDelayMs();
  const byApiId = new Map();
  let pages = 0;
  let items = 0;
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= maxPages) {
    const result = await api(sportSlug).getOddsByDate(date, page);
    const response = Array.isArray(result?.response) ? result.response : [];
    const paging = result?.paging ?? { current: page, total: 1 };
    totalPages = Math.max(1, Number(paging.total) || 1);
    pages++;

    for (const item of response) {
      const apiId = item?.fixture?.id;
      if (!Number.isFinite(Number(apiId))) continue;
      byApiId.set(Number(apiId), item);
      items++;
    }

    if (page >= totalPages) break;
    page++;
    if (pageDelayMs > 0) await sleep(pageDelayMs);
  }

  if (totalPages > maxPages) {
    console.warn(
      `[syncOddsBulk] ${sportSlug} ${date}: truncated at ${maxPages}/${totalPages} pages`,
    );
  }

  return { byApiId, pages, items };
}

/**
 * @param {object} [options]
 * @param {number} [options.horizonDays]
 * @param {string} [options.label]
 */
export default async function syncOddsBulkByDate(options = {}) {
  const horizonDays =
    Number(options.horizonDays) > 0
      ? Math.floor(Number(options.horizonDays))
      : getOddsHorizonDays();
  const label = options.label || `bulk-${horizonDays}d`;
  const dates = offsetsToDates(0, horizonDays - 1);

  console.log(
    `[syncOddsBulk] starting (${label}, horizon=${horizonDays}d, dates=${dates[0]} → ${dates[dates.length - 1]})`,
  );

  const enabled = getEnabledSports();
  if (!enabled.length) {
    console.warn("[syncOddsBulk] no enabled sports – nothing to do");
    return { label, upserts: 0, persisted: 0, dates: [] };
  }

  const preferredApiId = await getPreferredBookmakerApiId();
  const parseOptions = buildOddsParseOptions(preferredApiId);
  if (parseOptions.legacyPersistAllBookmakers) {
    console.warn(
      "[syncOddsBulk] no preferred bookmaker AND no DEFAULT_BOOKMAKER_API_ID / BOOKMAKER_FALLBACK_CHAIN – persisting all bookmakers (legacy behavior).",
    );
  } else {
    console.log(
      `[syncOddsBulk] bookmaker priority=${parseOptions.orderedBookmakerApiIds?.join(">") ?? "—"}` +
        (ALLOWED_MARKETS
          ? `, markets=${[...ALLOWED_MARKETS].join("|")}`
          : ", markets=all"),
    );
  }

  let totalUpserts = 0;
  let totalPersisted = 0;
  let totalMatched = 0;
  let totalSkippedUnknown = 0;
  let totalSkippedEmptyParse = 0;
  let totalPages = 0;
  let totalItems = 0;
  const dateStats = [];

  for (const sportSlug of enabled) {
    for (const date of dates) {
      const bounds = parseUtcYmdBounds(date);
      if (!bounds) continue;

      let byApiId;
      let pages = 0;
      let items = 0;
      try {
        ({ byApiId, pages, items } = await fetchOddsPagesForDate(
          sportSlug,
          date,
        ));
      } catch (err) {
        console.error(
          `[syncOddsBulk] ${sportSlug} ${date} fetch failed:`,
          err?.message || err,
        );
        dateStats.push({
          sport: sportSlug,
          date,
          error: String(err?.message || err),
        });
        continue;
      }

      totalPages += pages;
      totalItems += items;

      const missingFixtures = await prisma.fixture.findMany({
        where: {
          start_time: { gte: bounds.start, lte: bounds.end },
          status: { in: ["NS", "TBD"] },
          markets: { none: {} },
          league: { sport: { slug: sportSlug } },
        },
        select: {
          id: true,
          api_fixture_id: true,
          status: true,
        },
      });

      let matched = 0;
      let persisted = 0;
      let skippedEmptyParse = 0;
      let upserts = 0;

      // Upstream ids with no Mongo row at all (outside ingest rank gate).
      const upstreamIds = [...byApiId.keys()];
      const ingestedRows = upstreamIds.length
        ? await prisma.fixture.findMany({
            where: { api_fixture_id: { in: upstreamIds } },
            select: { api_fixture_id: true },
          })
        : [];
      const ingestedApiIds = new Set(
        ingestedRows.map((r) => Number(r.api_fixture_id)),
      );
      let skippedUnknown = 0;
      for (const apiId of byApiId.keys()) {
        if (!ingestedApiIds.has(apiId)) skippedUnknown++;
      }

      for (const fixture of missingFixtures) {
        const item = byApiId.get(Number(fixture.api_fixture_id));
        if (!item) continue;
        matched++;

        const parsed = parseMarkets([item], parseOptions);
        if (!parsed.bookmakers.length) {
          skippedEmptyParse++;
          continue;
        }

        try {
          upserts += await persistParsedOddsForFixture(fixture, parsed);
          persisted++;
          await deleteCache(
            `odds:fixture:${fixture.api_fixture_id}:no_odds`,
          ).catch(() => {});
        } catch (err) {
          console.error(
            `[syncOddsBulk] persist failed fixture=${fixture.api_fixture_id}:`,
            err?.message || err,
          );
        }
      }

      totalMatched += matched;
      totalPersisted += persisted;
      totalSkippedUnknown += skippedUnknown;
      totalSkippedEmptyParse += skippedEmptyParse;
      totalUpserts += upserts;

      console.log(
        `[syncOddsBulk] ${sportSlug} ${date}: pages=${pages}, items=${items}, matched=${matched}, persisted=${persisted}, skippedUnknown=${skippedUnknown}, emptyParse=${skippedEmptyParse}, upserts=${upserts}`,
      );
      dateStats.push({
        sport: sportSlug,
        date,
        pages,
        items,
        matched,
        persisted,
        skippedUnknown,
        skippedEmptyParse,
        upserts,
      });
    }
  }

  await deleteByPattern("fixtures:today:*");
  await deleteByPattern("fixtures:upcoming:*");
  await deleteByPattern("live:fixtures:*");
  if (totalUpserts > 0) {
    await deleteByPattern("odds:fixture:*:bk-*");
    try {
      const refreshed = await refreshFixturesByDateCaches();
      console.log(
        `[syncOddsBulk] fixtures by-date refreshed:`,
        refreshed.map((r) => `${r.ymd}=${r.count ?? r.error}`).join(", "),
      );
    } catch (err) {
      console.error(
        "[syncOddsBulk] fixtures by-date refresh failed:",
        err?.message || err,
      );
      await deleteByPattern("fixtures:by-date:*");
    }
  } else {
    console.log("[syncOddsBulk] skip fixtures by-date refresh (no odds upserts)");
  }

  console.log(
    `[syncOddsBulk] done (${label}) – pages=${totalPages}, items=${totalItems}, matched=${totalMatched}, persisted=${totalPersisted}, skippedUnknown=${totalSkippedUnknown}, emptyParse=${totalSkippedEmptyParse}, upserts=${totalUpserts}`,
  );

  return {
    label,
    horizonDays,
    upserts: totalUpserts,
    persisted: totalPersisted,
    matched: totalMatched,
    skippedUnknown: totalSkippedUnknown,
    skippedEmptyParse: totalSkippedEmptyParse,
    pages: totalPages,
    items: totalItems,
    dates: dateStats,
  };
}
