#!/usr/bin/env node
/**
 * Grandfather existing wallets: set `withdrawable = balance` so players
 * keep access to funds that were earned/deposited before this field existed.
 *
 * Run with:
 *   node backend/scripts/backfillWithdrawable.js          (dry run)
 *   node backend/scripts/backfillWithdrawable.js --apply  (write)
 *
 * Idempotent for wallets already migrated (skips when withdrawable === balance).
 */

import { prisma } from "../Config/db.js";

const APPLY = process.argv.includes("--apply");
const BATCH = Number(process.env.BACKFILL_BATCH || 500);

async function run() {
  const total = await prisma.wallet.count();
  console.log(
    `[backfill-withdrawable] wallets=${total} mode=${APPLY ? "APPLY" : "DRY_RUN"} batch=${BATCH}`,
  );

  let updated = 0;
  let skipped = 0;
  let cursor = null;

  while (true) {
    const rows = await prisma.wallet.findMany({
      select: { id: true, balance: true, withdrawable: true },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      const balance = Number(row.balance) || 0;
      const withdrawable = Number(row.withdrawable) || 0;
      if (withdrawable === balance) {
        skipped += 1;
        continue;
      }
      if (APPLY) {
        await prisma.wallet.update({
          where: { id: row.id },
          data: { withdrawable: balance },
        });
      }
      updated += 1;
    }
  }

  console.log(
    `[backfill-withdrawable] wouldUpdateOrUpdated=${updated} alreadyOk=${skipped}`,
  );
  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
