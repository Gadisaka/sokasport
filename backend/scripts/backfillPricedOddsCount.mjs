/**
 * One-off: recompute fixtures.extra_markets_count as unique priced odd-cell
 * counts (replacing the old “extra markets with ≥1 line” meaning).
 *
 * Usage: node scripts/backfillPricedOddsCount.mjs
 * Dry run: node scripts/backfillPricedOddsCount.mjs --dry-run
 */
import "dotenv/config";
import { prisma } from "../Config/db.js";
import { fetchPricedOddsCountsForFixtureIds } from "../services/extraMarketsCount.js";

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

  const ids = fixtures.map((fx) => fx.id);
  const BATCH = 100;
  let updated = 0;

  for (let i = 0; i < ids.length; i += BATCH) {
    const batchIds = ids.slice(i, i + BATCH);
    const counts = await fetchPricedOddsCountsForFixtureIds(batchIds);
    if (!dryRun) {
      for (const id of batchIds) {
        await prisma.fixture.update({
          where: { id },
          data: { extra_markets_count: counts.get(id) ?? 0 },
        });
      }
    }
    updated += batchIds.length;
    const lastId = batchIds[batchIds.length - 1];
    const lastFx = fixtures.find((fx) => fx.id === lastId);
    if (updated % 200 === 0 || updated === ids.length) {
      console.log(
        `[backfill-priced-odds-count] ${updated}/${ids.length} (last api=${lastFx?.api_fixture_id} count=${counts.get(lastId) ?? 0})`,
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
