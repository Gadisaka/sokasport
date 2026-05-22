#!/usr/bin/env node
/**
 * Shadow-mode settlement report.
 *
 * When `SETTLEMENT_ENGINE_SHADOW=v2` (or `v1`) the settlement service
 * grades every leg with both engines and records a
 * `SETTLEMENT_SHADOW_MISMATCH` audit row whenever the two disagree.
 *
 * This script aggregates those audit rows over a given time window so
 * operators can answer the "is V2 ready to cut over?" question:
 *
 *   - total mismatches
 *   - breakdown by market_code
 *   - breakdown by V1→V2 transition (e.g. `WON→LOST`)
 *   - top 10 offending market codes
 *
 * Usage:
 *   node backend/scripts/shadowSettlementReport.js              (last 24h)
 *   node backend/scripts/shadowSettlementReport.js --hours 168  (last 7d)
 *   node backend/scripts/shadowSettlementReport.js --since 2026-04-01
 *   node backend/scripts/shadowSettlementReport.js --json       (machine output)
 */
import { prisma } from "../Config/db.js";

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const asJson = process.argv.includes("--json");
const sinceArg = argValue("--since");
const hours = Number(argValue("--hours") || 24);

async function run() {
  const since = sinceArg
    ? new Date(sinceArg)
    : new Date(Date.now() - hours * 60 * 60 * 1000);
  if (!(since instanceof Date) || Number.isNaN(since.getTime())) {
    console.error("Invalid --since / --hours value");
    process.exit(2);
  }

  const rows = await prisma.auditLog.findMany({
    where: {
      action: "SETTLEMENT_SHADOW_MISMATCH",
      created_at: { gte: since },
    },
    orderBy: { created_at: "asc" },
  });

  const byMarket = new Map();
  const byTransition = new Map();
  for (const row of rows) {
    const marketCode = row.meta?.marketCode || "unknown";
    byMarket.set(marketCode, (byMarket.get(marketCode) || 0) + 1);

    const v1 = row.before?.v1?.result || "?";
    const v2 = row.after?.v2?.result || "?";
    const key = `${v1}→${v2}`;
    byTransition.set(key, (byTransition.get(key) || 0) + 1);
  }

  const sortedMarkets = [...byMarket.entries()].sort((a, b) => b[1] - a[1]);
  const sortedTransitions = [...byTransition.entries()].sort(
    (a, b) => b[1] - a[1],
  );

  const summary = {
    since: since.toISOString(),
    until: new Date().toISOString(),
    total_mismatches: rows.length,
    by_market: Object.fromEntries(sortedMarkets),
    by_transition: Object.fromEntries(sortedTransitions),
    top_markets: sortedMarkets.slice(0, 10).map(([code, n]) => ({ code, n })),
    recent_examples: rows.slice(-5).map((r) => ({
      id: r.id,
      selection_id: r.entity_id,
      market_code: r.meta?.marketCode,
      v1: r.before?.v1?.result,
      v2: r.after?.v2?.result,
      reason: r.after?.v2?.reason,
      at: r.created_at,
    })),
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(
    `\nShadow settlement mismatches since ${summary.since} (${summary.total_mismatches} total)\n`,
  );
  if (summary.total_mismatches === 0) {
    console.log("✓ No V1 vs V2 mismatches — V2 is consistent with V1.\n");
    return;
  }

  console.log("By market code:");
  for (const [code, n] of sortedMarkets) {
    console.log(`  ${code.padEnd(32)} ${n}`);
  }
  console.log("\nBy V1→V2 transition:");
  for (const [key, n] of sortedTransitions) {
    console.log(`  ${key.padEnd(14)} ${n}`);
  }

  console.log("\nMost recent 5:");
  for (const ex of summary.recent_examples) {
    console.log(
      `  [${ex.at.toISOString?.() || ex.at}] ${ex.market_code} ${ex.v1}→${ex.v2} (${ex.reason || "ok"})`,
    );
  }
  console.log("");
}

run()
  .catch((err) => {
    console.error("shadowSettlementReport fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
