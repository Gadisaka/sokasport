#!/usr/bin/env node
/**
 * Claw back cashback that was paid too early (while legs were still
 * pending) or at the wrong 1-loss / 2-loss amount, now that every
 * remaining leg has graded.
 *
 * Re-evaluates each credited ticket against current selections using
 * the original credit timestamp as `now` (so the 48h window is not
 * re-judged against today). Reverses `credited - owed` when positive.
 *
 * Ledger: a positive-amount BET row with unique reference
 * `cashback-reversal:<ticketId>`. Cashier tickets that were
 * CASHBACK_PAID go back to LOST and `paid_at` is cleared.
 *
 *   node backend/scripts/reverseWrongCashback.js          (dry run)
 *   node backend/scripts/reverseWrongCashback.js --apply  (write)
 *
 * Idempotent: a ticket that already has `cashback-reversal:<id>` is skipped.
 */
import { prisma } from "../Config/db.js";
import { logAuditEvent } from "../lib/auditLog.js";
import {
  cashbackReversalRef,
  evaluateCashback,
  loadCashbackContext,
} from "../lib/bonusEngine.js";
import { hasCashierPrintTx } from "../services/cashbackPayoutService.js";
import { debitWallet } from "../lib/walletBalance.js";

const APPLY = process.argv.includes("--apply");
const RESOLVED = new Set(["WON", "LOST", "VOID"]);

function ticketIdFromCreditRef(reference) {
  const ref = String(reference ?? "");
  const bonusPrefix = "bonus:cashback:";
  const payoutPrefix = "cashback-payout:";
  if (ref.startsWith(bonusPrefix)) return ref.slice(bonusPrefix.length);
  if (ref.startsWith(payoutPrefix)) return ref.slice(payoutPrefix.length);
  return null;
}

function hasPendingLeg(selections) {
  if (!Array.isArray(selections) || selections.length === 0) return true;
  return selections.some(
    (s) => !s || !RESOLVED.has(String(s.result ?? "").toUpperCase()),
  );
}

async function main() {
  const bonus = await prisma.bonus.findFirst({
    where: { type: "CASHBACK" },
  });
  if (!bonus) {
    console.log("[cashback-reverse] no CASHBACK bonus row; nothing to do");
    return;
  }
  // Evaluate against configured rules even if the program is currently off.
  const rulesBonus = { ...bonus, status: true };

  const credits = await prisma.transaction.findMany({
    where: {
      type: "BONUS",
      OR: [
        { reference: { startsWith: "bonus:cashback:" } },
        { reference: { startsWith: "cashback-payout:" } },
      ],
    },
    select: {
      id: true,
      wallet_id: true,
      amount: true,
      reference: true,
      created_at: true,
    },
    orderBy: { created_at: "asc" },
  });

  const byTicket = new Map();
  for (const row of credits) {
    const ticketId = ticketIdFromCreditRef(row.reference);
    if (!ticketId) continue;
    if (!byTicket.has(ticketId)) byTicket.set(ticketId, row);
  }

  const summary = {
    scanned: byTicket.size,
    stillPending: 0,
    correct: 0,
    overCredited: 0,
    overCreditedAmount: 0,
    reversed: 0,
    reversedAmount: 0,
    needsManual: 0,
    skippedMissing: 0,
    alreadyReversed: 0,
  };
  const overpaid = [];
  const needsManual = [];

  for (const [ticketId, credit] of byTicket) {
    const reversalRef = cashbackReversalRef(ticketId);
    const already = await prisma.transaction.findFirst({
      where: { reference: reversalRef },
      select: { id: true },
    });
    if (already) {
      summary.alreadyReversed++;
      continue;
    }

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      summary.skippedMissing++;
      continue;
    }

    const { selections, fixtureStatuses, matchStatuses } =
      await loadCashbackContext(prisma, ticketId);
    if (hasPendingLeg(selections)) {
      summary.stillPending++;
      continue;
    }

    const printed = await hasCashierPrintTx(prisma, ticketId);
    const ev = evaluateCashback({
      ticket,
      selections,
      fixtureStatuses,
      matchStatuses,
      bonus: rulesBonus,
      now: credit.created_at,
      isOnline: !printed,
    });
    const owed = ev.eligible ? Number(ev.amount) || 0 : 0;
    const credited = Number(credit.amount) || 0;
    const delta = credited - owed;
    if (!(delta > 0)) {
      summary.correct++;
      continue;
    }

    summary.overCredited++;
    summary.overCreditedAmount += delta;
    const row = {
      ticketId,
      coupon: ticket.coupon_number,
      receipt: ticket.receipt_number,
      channel: printed ? "cashier" : "online",
      credited,
      owed,
      delta,
      reason: ev.reason,
      profileKey: ev.profileKey,
      status: ticket.status,
    };
    overpaid.push(row);

    if (!APPLY) continue;

    try {
      await prisma.$transaction(async (tx) => {
        const dup = await tx.transaction.findFirst({
          where: { reference: reversalRef },
          select: { id: true },
        });
        if (dup) return;

        const wallet = await tx.wallet.findUnique({
          where: { id: credit.wallet_id },
        });
        if (!wallet) {
          throw new Error("NO_WALLET");
        }

        const debited = await debitWallet(tx, wallet, delta, {
          fromWithdrawable: false,
        });
        await tx.transaction.create({
          data: {
            wallet_id: wallet.id,
            type: "BET",
            amount: delta,
            balance_before: debited.balanceBefore,
            balance_after: debited.balanceAfter,
            reference: reversalRef,
          },
        });

        if (ticket.status === "CASHBACK_PAID" || printed) {
          await tx.ticket.update({
            where: { id: ticketId },
            data: { status: "LOST", paid_at: null },
          });
        }
      });

      await logAuditEvent({
        action: "TICKET_CASHBACK_REVERSED",
        module: "TICKETS",
        entityType: "TICKET",
        entityId: ticketId,
        actorRole: "SYSTEM",
        before: { status: ticket.status, credited, owed },
        after: { status: "LOST", delta, reason: ev.reason },
        meta: {
          coupon: ticket.coupon_number,
          channel: printed ? "cashier" : "online",
          creditRef: credit.reference,
          reversalRef,
        },
      }).catch((auditErr) => {
        console.error(
          `[cashback-reverse] audit failed ticket=${ticketId}:`,
          auditErr?.message || auditErr,
        );
      });

      summary.reversed++;
      summary.reversedAmount += delta;
    } catch (err) {
      if (err?.message === "INSUFFICIENT_BALANCE" || err?.message === "NO_WALLET") {
        summary.needsManual++;
        needsManual.push({ ...row, error: err.message });
        continue;
      }
      throw err;
    }
  }

  console.log(
    `[cashback-reverse] mode=${APPLY ? "APPLY" : "DRY_RUN"} bonus=${bonus.id} status=${bonus.status}`,
  );
  console.log("[cashback-reverse] summary");
  console.log(
    JSON.stringify(
      {
        ...summary,
        overCreditedAmount: Math.round(summary.overCreditedAmount * 100) / 100,
        reversedAmount: Math.round(summary.reversedAmount * 100) / 100,
      },
      null,
      2,
    ),
  );
  if (overpaid.length) {
    console.log("[cashback-reverse] over-credited (up to 50)");
    console.log(JSON.stringify(overpaid.slice(0, 50), null, 2));
  }
  if (needsManual.length) {
    console.log("[cashback-reverse] needs-manual (insufficient wallet)");
    console.log(JSON.stringify(needsManual, null, 2));
  }
  if (!APPLY && summary.overCredited > 0) {
    console.log("[cashback-reverse] re-run with --apply to write reversals");
  }
}

main()
  .catch((err) => {
    console.error("[cashback-reverse] fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
