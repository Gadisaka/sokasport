import prisma from "../Config/db.js";
import { countUniquePricedSelections } from "./lib/pricedOddsCount.js";

export { countUniquePricedSelections } from "./lib/pricedOddsCount.js";

/**
 * Persist total unique priced odd-cell count for a fixture into
 * `extra_markets_count` (column name kept for API compatibility; value is no
 * longer “extra market count”). Called whenever odds rows change for that fixture.
 */
export async function recomputeExtraMarketsCountForFixture(fixtureId) {
  const lines = await prisma.fixtureOddLine.findMany({
    where: { market: { fixture_id: fixtureId } },
    select: { market_id: true, value: true, odd: true },
  });
  const n = countUniquePricedSelections(lines);
  await prisma.fixture.update({
    where: { id: fixtureId },
    data: { extra_markets_count: n },
  });
  return n;
}
