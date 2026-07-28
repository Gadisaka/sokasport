#!/usr/bin/env node
/**
 * Recompute PLAYER `withdrawable` from the transaction ledger.
 *
 * Fixes wallets where balance includes MRX / InOut / sportsbook winnings but
 * `withdrawable` stayed 0 (or drifted). Does not change `balance`.
 *
 * Run:
 *   node backend/scripts/repairWithdrawableFromLedger.mjs
 *   node backend/scripts/repairWithdrawableFromLedger.mjs --apply
 *   node backend/scripts/repairWithdrawableFromLedger.mjs --apply --only-zero
 *
 * Flags:
 *   --apply       Write updates (default is dry-run)
 *   --only-zero   Only repair wallets currently at withdrawable === 0
 *   --wallet=ID   Limit to a single wallet id
 */

import { prisma } from "../Config/db.js";
import { toMoney } from "../lib/moneyDecimal.js";
import { replayWithdrawableLedger } from "../lib/withdrawableLedger.js";

const APPLY = process.argv.includes("--apply");
const ONLY_ZERO = process.argv.includes("--only-zero");
const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
const ONLY_WALLET = walletArg ? walletArg.slice("--wallet=".length) : null;
const BATCH = Number(process.env.REPAIR_BATCH || 200);

async function loadLedger(walletId) {
  return prisma.transaction.findMany({
    where: { wallet_id: walletId },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    select: {
      type: true,
      amount: true,
      reference: true,
      balance_before: true,
      balance_after: true,
    },
  });
}

async function run() {
  const where = {
    wallet_type: "PLAYER",
    ...(ONLY_WALLET ? { id: ONLY_WALLET } : {}),
  };

  const total = await prisma.wallet.count({ where });
  console.log(
    `[repair-withdrawable] players=${total} mode=${APPLY ? "APPLY" : "DRY_RUN"} onlyZero=${ONLY_ZERO} batch=${BATCH}`,
  );

  let scanned = 0;
  let wouldFix = 0;
  let fixed = 0;
  let skipped = 0;
  let balanceMismatch = 0;
  let cursor = null;

  while (true) {
    const rows = await prisma.wallet.findMany({
      where,
      select: { id: true, balance: true, withdrawable: true, user_id: true },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned += 1;
      const balance = toMoney(row.balance);
      const current = toMoney(row.withdrawable ?? 0);

      if (ONLY_ZERO && current !== 0) {
        skipped += 1;
        continue;
      }

      const ledger = await loadLedger(row.id);
      const replayed = replayWithdrawableLedger(ledger);
      // Never raise withdrawable above live balance (ledger may drift).
      const next = toMoney(Math.min(replayed.withdrawable, balance));

      if (Math.abs(replayed.balance - balance) > 0.02) {
        balanceMismatch += 1;
        console.warn(
          `[warn] wallet=${row.id} user=${row.user_id} ledgerBalance=${replayed.balance} liveBalance=${balance} (clamping withdrawable to live balance)`,
        );
      }

      if (next === current) {
        skipped += 1;
        continue;
      }

      wouldFix += 1;
      console.log(
        `[fix] wallet=${row.id} user=${row.user_id} balance=${balance} withdrawable ${current} → ${next}`,
      );

      if (APPLY) {
        await prisma.wallet.update({
          where: { id: row.id },
          data: { withdrawable: next },
        });
        fixed += 1;
      }
    }
  }

  console.log(
    `[repair-withdrawable] scanned=${scanned} wouldFix=${wouldFix} fixed=${fixed} skipped=${skipped} balanceMismatch=${balanceMismatch}`,
  );
  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
