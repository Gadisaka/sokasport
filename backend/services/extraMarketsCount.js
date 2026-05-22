import prisma from "../Config/db.js";

/** Matches list summary + frontend `MAIN_MARKET_NAMES` (non–“extra” markets). */
export const EXTRA_MARKETS_SUMMARY_NAMES = ["Match Winner", "Double Chance"];

/**
 * Count of fixture markets other than MW/DC that have at least one odd line
 * (any bookmaker). Updated whenever odds rows change for that fixture.
 */
export async function recomputeExtraMarketsCountForFixture(fixtureId) {
  const n = await prisma.fixtureMarket.count({
    where: {
      fixture_id: fixtureId,
      name: { notIn: EXTRA_MARKETS_SUMMARY_NAMES },
      odd_lines: { some: {} },
    },
  });
  await prisma.fixture.update({
    where: { id: fixtureId },
    data: { extra_markets_count: n },
  });
  return n;
}
