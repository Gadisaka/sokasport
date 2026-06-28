#!/usr/bin/env node
/**
 * Read-only check: `transactions.reference` should have a unique MongoDB index.
 *
 * Run:
 *   node backend/scripts/verifyTransactionReferenceIndex.mjs
 *
 * Exit 0 when the unique index exists; exit 1 otherwise.
 */
import { prisma } from "../Config/db.js";

function indexEntries(raw) {
  if (Array.isArray(raw?.cursor?.firstBatch)) return raw.cursor.firstBatch;
  if (Array.isArray(raw?.indexes)) return raw.indexes;
  return [];
}

function isUniqueReferenceIndex(index) {
  const key = index?.key ?? {};
  const fields = Object.keys(key);
  return fields.length === 1 && fields[0] === "reference" && index.unique === true;
}

async function run() {
  const raw = await prisma.$runCommandRaw({
    listIndexes: "transactions",
  });
  const indexes = indexEntries(raw);

  console.log("[verify-index] transactions collection indexes:");
  for (const index of indexes) {
    const unique = index.unique ? " unique" : "";
    console.log(`  - ${index.name}:${unique} ${JSON.stringify(index.key ?? {})}`);
  }

  const refIndex = indexes.find(isUniqueReferenceIndex);
  if (refIndex) {
    console.log(
      `\n[verify-index] OK: unique index on reference exists (${refIndex.name})`,
    );
    return;
  }

  console.error(
    "\n[verify-index] MISSING: no unique index on transactions.reference",
  );
  console.error("  From backend/: npm run db:push");
  process.exit(1);
}

run()
  .catch((err) => {
    console.error("[verify-index] fatal:", err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
