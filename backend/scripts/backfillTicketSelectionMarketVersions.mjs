import "dotenv/config";
import { prisma } from "../Config/db.js";

async function run() {
  const rows = await prisma.ticketSelection.findMany({
    where: { server_market_version: null },
    select: { id: true, market_version: true },
  });
  let updated = 0;
  for (const row of rows) {
    const marketVersion = Number(row.market_version);
    await prisma.ticketSelection.update({
      where: { id: row.id },
      data: {
        server_market_version: Number.isFinite(marketVersion) ? marketVersion : 0,
      },
    });
    updated += 1;
  }
  console.log(`[backfill-market-versions] updated ${updated} rows`);
}

run()
  .catch((err) => {
    console.error("[backfill-market-versions] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

