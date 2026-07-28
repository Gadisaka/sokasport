#!/usr/bin/env node
/**
 * Diagnose why a player has balance but withdrawable === 0.
 *
 * Usage (docker):
 *   docker compose -f docker-compose.prod.yml exec backend \
 *     node scripts/diagnoseWithdrawable.mjs --phone=0911XXXXXX
 *
 *   docker compose -f docker-compose.prod.yml exec backend \
 *     node scripts/diagnoseWithdrawable.mjs --user=USER_ID
 */

import { prisma } from "../Config/db.js";
import { toMoney } from "../lib/moneyDecimal.js";
import { normalizeEthiopiaPhone } from "../lib/phone.js";
import { replayWithdrawableLedger } from "../lib/withdrawableLedger.js";

const phoneArg = process.argv.find((a) => a.startsWith("--phone="));
const userArg = process.argv.find((a) => a.startsWith("--user="));
const phone = phoneArg ? phoneArg.slice("--phone=".length) : null;
const userId = userArg ? userArg.slice("--user=".length) : null;

if (!phone && !userId) {
  console.error("Usage: node scripts/diagnoseWithdrawable.mjs --phone=09... OR --user=...");
  process.exit(1);
}

async function main() {
  let user;
  if (userId) {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, username: true, fullname: true },
    });
  } else {
    const canonical = normalizeEthiopiaPhone(phone);
    user = await prisma.user.findFirst({
      where: { phone: canonical || phone },
      select: { id: true, phone: true, username: true, fullname: true },
    });
  }

  if (!user) {
    console.error("User not found");
    process.exit(1);
  }

  const wallet = await prisma.wallet.findFirst({
    where: { user_id: user.id, wallet_type: "PLAYER" },
  });
  if (!wallet) {
    console.error("PLAYER wallet not found for", user.id);
    process.exit(1);
  }

  const ledger = await prisma.transaction.findMany({
    where: { wallet_id: wallet.id },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
  });

  const replayed = replayWithdrawableLedger(ledger);
  const gameWins = ledger.filter(
    (t) =>
      t.type === "PAYOUT" &&
      (String(t.reference || "").startsWith("mrx:win:") ||
        String(t.reference || "").startsWith("inout:withdraw:") ||
        String(t.reference || "").startsWith("win-settlement:")),
  );
  const gameBets = ledger.filter(
    (t) =>
      t.type === "BET" &&
      (String(t.reference || "").startsWith("mrx:fee:") ||
        String(t.reference || "").startsWith("inout:bet:")),
  );
  const recent = [...ledger].slice(-15).reverse();

  console.log(
    JSON.stringify(
      {
        user,
        wallet: {
          id: wallet.id,
          balance: wallet.balance,
          withdrawable: wallet.withdrawable ?? 0,
          wallet_type: wallet.wallet_type,
        },
        replayed,
        drift: {
          withdrawableLive: toMoney(wallet.withdrawable ?? 0),
          withdrawableFromLedger: replayed.withdrawable,
          needsRepair:
            toMoney(wallet.withdrawable ?? 0) !==
            toMoney(Math.min(replayed.withdrawable, toMoney(wallet.balance))),
        },
        counts: {
          ledgerRows: ledger.length,
          gameBets: gameBets.length,
          gameWins: gameWins.length,
          gameWinTotal: toMoney(
            gameWins.reduce((s, t) => s + Number(t.amount || 0), 0),
          ),
        },
        recentGameWins: gameWins.slice(-10).map((t) => ({
          amount: t.amount,
          reference: t.reference,
          created_at: t.created_at,
        })),
        recentLedger: recent.map((t) => ({
          type: t.type,
          amount: t.amount,
          reference: t.reference,
          balance_before: t.balance_before,
          balance_after: t.balance_after,
          created_at: t.created_at,
        })),
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
