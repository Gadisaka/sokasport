#!/usr/bin/env node
/**
 * Resolve duplicate `Transaction.reference` values so the unique index can be created.
 *
 * Keeps the oldest row (by created_at, then id) for each reference.
 * Renames other rows to `legacy:<transaction.id>`.
 *
 * Run:
 *   node backend/scripts/dedupeTransactionReferences.mjs         (dry run)
 *   node backend/scripts/dedupeTransactionReferences.mjs --apply (write)
 */
import { prisma } from "../Config/db.js";

const APPLY = process.argv.includes("--apply");

function aggregateRows(raw) {
  if (Array.isArray(raw?.cursor?.firstBatch)) return raw.cursor.firstBatch;
  if (Array.isArray(raw?.results)) return raw.results;
  return [];
}

async function findDuplicateGroups() {
  const raw = await prisma.$runCommandRaw({
    aggregate: "transactions",
    pipeline: [
      { $match: { reference: { $ne: null } } },
      {
        $group: {
          _id: "$reference",
          count: { $sum: 1 },
          rows: {
            $push: {
              id: "$_id",
              created_at: "$created_at",
            },
          },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ],
    cursor: {},
  });
  return aggregateRows(raw);
}

function pickKeeperAndDuplicates(rows) {
  const sorted = [...rows].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
  const keeper = sorted[0];
  const duplicates = sorted.slice(1);
  return { keeper, duplicates };
}

async function run() {
  const groups = await findDuplicateGroups();
  console.log(
    `[dedupe] duplicate reference groups=${groups.length} mode=${APPLY ? "APPLY" : "DRY_RUN"}`,
  );

  if (groups.length === 0) {
    console.log("[dedupe] nothing to do");
    return;
  }

  let renamed = 0;
  for (const group of groups) {
    const reference = String(group._id ?? "");
    const { keeper, duplicates } = pickKeeperAndDuplicates(group.rows ?? []);
    console.log(
      `[dedupe] reference="${reference}" count=${group.count} keep=${keeper.id} rename=${duplicates.length}`,
    );

    if (!APPLY) {
      renamed += duplicates.length;
      continue;
    }

    for (const row of duplicates) {
      await prisma.transaction.update({
        where: { id: String(row.id) },
        data: { reference: `legacy:${row.id}` },
      });
      renamed += 1;
    }
  }

  console.log(`[dedupe] done: ${APPLY ? "renamed" : "would_rename"}=${renamed} rows`);
}

run()
  .catch((err) => {
    console.error("[dedupe] fatal:", err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
