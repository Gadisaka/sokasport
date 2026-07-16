import prisma from "../Config/db.js";
import { countUniquePricedSelections } from "./lib/pricedOddsCount.js";

export { countUniquePricedSelections } from "./lib/pricedOddsCount.js";

/**
 * Batch priced odd-cell counts for list responses (avoids stale DB column).
 * Uses market_id lookups (not nested relation filters) for Mongo reliability.
 *
 * @param {string[]} fixtureIds
 * @param {{ bookmakerId?: string | null }} [opts]
 * @returns {Promise<Map<string, number>>}
 */
export async function fetchPricedOddsCountsForFixtureIds(
  fixtureIds = [],
  { bookmakerId = null } = {},
) {
  const unique = [...new Set(fixtureIds.filter(Boolean))];
  const counts = new Map(unique.map((id) => [id, 0]));
  if (!unique.length) return counts;

  const markets = await prisma.fixtureMarket.findMany({
    where: { fixture_id: { in: unique } },
    select: { id: true, fixture_id: true },
  });
  if (!markets.length) return counts;

  const marketToFixture = new Map(
    markets.map((m) => [m.id, m.fixture_id]),
  );
  const lines = await prisma.fixtureOddLine.findMany({
    where: {
      market_id: { in: markets.map((m) => m.id) },
      ...(bookmakerId ? { bookmaker_id: bookmakerId } : {}),
    },
    select: { market_id: true, value: true, odd: true },
  });

  const buckets = new Map();
  for (const line of lines) {
    const fixtureId = marketToFixture.get(line.market_id);
    if (!fixtureId) continue;
    if (!buckets.has(fixtureId)) buckets.set(fixtureId, []);
    buckets.get(fixtureId).push({
      market_id: line.market_id,
      value: line.value,
      odd: line.odd,
    });
  }

  for (const id of unique) {
    counts.set(id, countUniquePricedSelections(buckets.get(id) || []));
  }
  return counts;
}

/**
 * Persist total unique priced odd-cell count for a fixture into
 * `extra_markets_count` (column name kept for API compatibility; value is no
 * longer “extra market count”). Called whenever odds rows change for that fixture.
 */
export async function recomputeExtraMarketsCountForFixture(fixtureId) {
  const counts = await fetchPricedOddsCountsForFixtureIds([fixtureId]);
  const n = counts.get(fixtureId) ?? 0;
  await prisma.fixture.update({
    where: { id: fixtureId },
    data: { extra_markets_count: n },
  });
  return n;
}
