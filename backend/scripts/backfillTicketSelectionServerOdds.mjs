import "dotenv/config";
import { prisma } from "../Config/db.js";

async function run() {
  const rows = await prisma.ticketSelection.findMany({
    where: { server_odds: null },
    select: { id: true, odds: true },
  });
  if (!rows.length) {
    console.log("[backfill-server-odds] nothing to update");
    return;
  }
  let updated = 0;
  for (const row of rows) {
    await prisma.ticketSelection.update({
      where: { id: row.id },
      data: {
        server_odds: Number(row.odds),
        server_odds_at: new Date(),
      },
    });
    updated++;
    if (updated % 500 === 0) {
      console.log(`[backfill-server-odds] updated ${updated}/${rows.length}`);
    }
  }
  console.log(`[backfill-server-odds] updated ${updated} rows`);
}

run()
  .catch((err) => {
    console.error("[backfill-server-odds] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
