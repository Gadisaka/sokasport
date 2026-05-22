/**
 * Clears API-ingestion collections and flushes Redis so workers can repopulate.
 *
 * Uses Mongo `drop` (not `deleteMany`) to avoid BSON size limits on huge tables.
 *
 * Does NOT delete: users, tickets, internal `matches`, sports, settings.
 * Clears `ticket_selections.fixture_id` so tickets are not left pointing at
 * removed fixtures (selection rows stay; settlement may need manual review).
 *
 * Usage:
 *   node scripts/resetIngestionData.mjs
 *   node scripts/resetIngestionData.mjs --sync   # then run syncFixtures + syncOdds (needs API keys)
 *
 * Env (optional): POST_RESET_ODDS_MAX_FIXTURES — cap for the post-reset odds run (default 500).
 */
import "dotenv/config";
import Redis from "ioredis";
import prisma from "../Config/db.js";
import syncFixtures from "../jobs/syncFixtures.js";
import syncOdds from "../jobs/syncOdds.js";

/** @@map collection names from schema.prisma */
const DROP_ORDER = [
  "fixture_odd_lines",
  "fixture_markets",
  "fixtures",
  "teams",
  "bookmakers",
];

async function dropCollection(name) {
  try {
    await prisma.$runCommandRaw({ drop: name });
    console.log(`[reset] dropped collection: ${name}`);
  } catch (err) {
    // Code 26 = NamespaceNotFound (already gone)
    const msg = String(err?.message ?? err);
    if (msg.includes("26") || msg.toLowerCase().includes("not found")) {
      console.log(`[reset] skip ${name} (missing or already dropped)`);
    } else {
      throw err;
    }
  }
}

async function main() {
  const wantSync = process.argv.includes("--sync");

  console.log("[reset] Clearing fixture_id from ticket_selections…");
  const unlinked = await prisma.ticketSelection.updateMany({
    where: { fixture_id: { not: null } },
    data: { fixture_id: null },
  });
  console.log(`[reset]   → updated ${unlinked.count} selection(s)`);

  for (const c of DROP_ORDER) {
    await dropCollection(c);
  }

  console.log("[reset] Dropping collection: leagues");
  try {
    await prisma.$runCommandRaw({ drop: "leagues" });
    console.log("[reset]   → dropped leagues");
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (msg.includes("26") || msg.toLowerCase().includes("not found")) {
      console.log("[reset] skip leagues (missing)");
    } else {
      console.error(
        "[reset] drop leagues failed — internal `matches` may still reference league ids. Fix DB manually if needed.",
        err?.message ?? err,
      );
    }
  }

  const url = process.env.REDIS_URL || "redis://localhost:6379";
  console.log(`[reset] Flushing Redis (${url})…`);
  const redis = new Redis(url, { maxRetriesPerRequest: null });
  try {
    await redis.flushall();
    console.log(
      "[reset]   → FLUSHALL OK (BullMQ + API cache; restart worker to re-register jobs)",
    );
  } finally {
    redis.disconnect();
  }

  if (wantSync) {
    console.log("[reset] --sync: running fixture ingest (upstream API)…");
    await syncFixtures();
    console.log("[reset] --sync: running odds ingest…");
    await syncOdds({
      label: "post-reset",
      maxFixtures: Number(process.env.POST_RESET_ODDS_MAX_FIXTURES || 500),
      mode: "all_in_horizon",
    });
    console.log(
      "[reset] --sync finished. Restart the BullMQ worker if you use it — FLUSHALL cleared queues/repeatables.",
    );
  } else {
    console.log(
      "[reset] Next: run ingestion — e.g. `npm run worker` (and/or `node scripts/resetIngestionData.mjs --sync`), or enqueue sync jobs.",
    );
  }

  await prisma.$disconnect();
  console.log("[reset] Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
