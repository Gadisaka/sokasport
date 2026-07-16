/**
 * One-off: recompute fixtures.extra_markets_count as unique priced odd-cell
 * counts (replacing the old “extra markets with ≥1 line” meaning).
 *
 * Usage: node scripts/backfillPricedOddsCount.mjs
 * Dry run: node scripts/backfillPricedOddsCount.mjs --dry-run
 */
import "dotenv/config";
import { prisma } from "../Config/db.js";
import { countUniquePricedSelections } from "../services/lib/pricedOddsCount.js";

const dryRun = process.argv.includes("--dry-run");

async function run() {
  const fixtures = await prisma.fixture.findMany({
    where: { markets: { some: {} } },
    select: { id: true, api_fixture_id: true },
  });

  console.log(
    `[backfill-priced-odds-count] ${fixtures.length} fixtures with markets` +
      (dryRun ? " (dry-run)" : ""),
  );

  let updated = 0;
  for (const fx of fixtures) {
    const lines = await prisma.fixtureOddLine.findMany({
      where: { market: { fixture_id: fx.id } },
      select: { market_id: true, value: true, odd: true },
    });
    const n = countUniquePricedSelections(lines);
    if (!dryRun) {
      await prisma.fixture.update({
        where: { id: fx.id },
        data: { extra_markets_count: n },
      });
    }
    updated++;
    if (updated % 200 === 0) {
      console.log(
        `[backfill-priced-odds-count] ${updated}/${fixtures.length} (last api=${fx.api_fixture_id} count=${n})`,
      );
    }
  }

  console.log(
    `[backfill-priced-odds-count] done ${updated} fixtures` +
      (dryRun ? " (no writes)" : ""),
  );
}

run()
  .catch((err) => {
    console.error("[backfill-priced-odds-count] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
