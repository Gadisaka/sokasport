#!/usr/bin/env node
/**
 * Backfill `Transaction.reference` for rows created before the
 * `@unique` constraint was added.
 *
 * Strategy:
 *   - Rows missing a reference are given a deterministic fallback
 *     `legacy:<transaction.id>` so subsequent concurrent settlement
 *     runs can't accidentally collide with them.
 *   - The legacy prefix makes these rows easy to filter out of
 *     settlement / payout lookups that search for
 *     `win-settlement:*`, `ticket-print:*`, `ticket:*`,
 *     `bet-refund:*`, `cashout:*`.
 *
 * Run with:
 *   node backend/scripts/backfillReferences.js         (dry run)
 *   node backend/scripts/backfillReferences.js --apply (write)
 *
 * Designed to be idempotent — re-running it is a no-op after the
 * first successful pass.
 */

import { prisma } from "../Config/db.js";

const APPLY = process.argv.includes("--apply");
const BATCH = Number(process.env.BACKFILL_BATCH || 500);

async function run() {
  const total = await prisma.transaction.count({ where: { reference: null } });
  console.log(
    `[backfill] rows missing reference=${total} mode=${APPLY ? "APPLY" : "DRY_RUN"} batch=${BATCH}`,
  );

  let updated = 0;
  let cursor = null;

  while (true) {
    const rows = await prisma.transaction.findMany({
      where: { reference: null },
      select: { id: true },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    if (APPLY) {
      // Mongo does not support `updateMany` with per-row references,
      // so we emit individual updates inside a transaction batch.
      await prisma.$transaction(
        rows.map((r) =>
          prisma.transaction.update({
            where: { id: r.id },
            data: { reference: `legacy:${r.id}` },
          }),
        ),
      );
      updated += rows.length;
      console.log(`[backfill] updated=${updated}/${total}`);
    } else {
      updated += rows.length;
    }
  }

  console.log(
    `[backfill] done: ${APPLY ? "wrote" : "would_write"}=${updated} rows`,
  );
}

run()
  .catch((err) => {
    console.error("[backfill] fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
