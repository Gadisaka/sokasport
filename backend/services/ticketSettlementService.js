/**
 * Ticket Settlement Service.
 *
 * Single entrypoint used by:
 *   - the manual admin override (`PATCH /api/admin/games/matches/:id/result`),
 *   - the fixture-level override (`POST /api/admin/fixtures/:id/result`),
 *   - the auto-settlement hook fired from fixture sync jobs,
 *   - the `settlement:retry` repeatable job for fixtures stuck with
 *     pending legs.
 *
 * Engine selection:
 *   - `process.env.SETTLEMENT_ENGINE === "v2"` → grade via
 *     `services/marketEvaluatorV2.js` using `MatchResultV2`.
 *   - default / any other value → grade via the V1 engine
 *     (`services/marketEvaluator.js`) for backward compatibility.
 *   - `process.env.SETTLEMENT_ENGINE_SHADOW === "v2"` → V1 owns the
 *     ticket outcome AND V2 grades every leg in parallel. Mismatches
 *     are recorded via `SETTLEMENT_SHADOW_MISMATCH` audit logs. Shadow
 *     NEVER mutates a ticket's status.
 *
 * Responsibilities:
 *   1. Grade every `TicketSelection` row tied to the resolved match/fixture.
 *   2. Recompute affected ticket statuses with the canonical rules
 *      (LOST precedence; all-VOID → ticket VOID + refund; else WON).
 *   3. For online (player-owned, non-cashier-printed) tickets that
 *      transition to WON, credit the player wallet inside the same
 *      Prisma transaction. For VOID tickets, refund the stake.
 *      Idempotency enforced through:
 *        - `Transaction.reference @unique` (DB-level),
 *        - `Fixture.grading_completed_at` / `Match.settled_at`
 *          (skip-if-done gate).
 *
 * Cashier-sold tickets (those that already have a `ticket-print:<id>`
 * BET transaction on the cashier wallet) keep using the existing
 * cashier-driven `payoutTicket` flow so wallet ownership stays correct.
 *
 * @module services/ticketSettlementService
 */
import { prisma } from "../Config/db.js";
import {
  evaluateSelection as evaluateSelectionV1,
  SELECTION_RESULT,
} from "./marketEvaluator.js";
import { gradeSelectionWithOverride } from "../lib/fixtureMarketOverrides.js";
import {
  evaluateSelection as evaluateSelectionV2,
  ENGINE_VERSION as V2_ENGINE_VERSION,
} from "./marketEvaluatorV2.js";
import {
  buildMatchResultV2FromFixture,
  buildMatchResultV2FromMatch,
} from "./matchResult/v2.js";
import { ticketWinningsTaxBreakdown } from "../lib/winningsTax.js";
import { creditCashbackOnLostTicketInTx } from "../lib/bonusEngine.js";
import {
  capGrossPotentialWin,
  resolveBettingLimits,
} from "../lib/bettingLimits.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { recordUngradedLeg } from "../lib/settlementMetrics.js";
import {
  creditWallet,
  restoreWallet,
  walletSnapshot,
} from "../lib/walletBalance.js";

const FINAL_FIXTURE_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);
const VOID_FIXTURE_STATUSES = new Set(["CANC", "ABD", "PST"]);

const SETTLEABLE_TICKET_STATUSES = new Set(["OPEN", "PRINTED", "HELD"]);
const TERMINAL_TICKET_STATUSES = new Set([
  "WON",
  "LOST",
  "PAID",
  "VOID",
  "CANCELED",
  "CASHED_OUT",
]);

export function isFinalFixtureStatus(status) {
  return FINAL_FIXTURE_STATUSES.has(String(status || "").toUpperCase());
}

export function isVoidFixtureStatus(status) {
  return VOID_FIXTURE_STATUSES.has(String(status || "").toUpperCase());
}

export function isTerminalFixtureStatus(status) {
  const upper = String(status || "").toUpperCase();
  return FINAL_FIXTURE_STATUSES.has(upper) || VOID_FIXTURE_STATUSES.has(upper);
}

function useV2Engine() {
  return String(process.env.SETTLEMENT_ENGINE || "").toLowerCase() === "v2";
}

function useShadow() {
  return String(process.env.SETTLEMENT_ENGINE_SHADOW || "").toLowerCase() === "v2";
}

// Boot-time footgun guard. V2 grades event/stat markets (corners, cards,
// goalscorers) from enrichment payloads. With V2 selected but enrichment off,
// those markets settle VOID for lack of data (and refund stakes) instead of
// grading. Surface it loudly so the cutover runbook turns on enrichment in
// lockstep with the engine flip.
if (
  String(process.env.SETTLEMENT_ENGINE || "").toLowerCase() === "v2" &&
  String(process.env.ENABLE_FIXTURE_ENRICHMENT || "").trim() !== "1"
) {
  console.warn(
    "[settlement] CONFIG WARNING: SETTLEMENT_ENGINE=v2 but ENABLE_FIXTURE_ENRICHMENT!=1 — " +
      "event/stat markets (corners, cards, goalscorers) will settle VOID for lack of data. " +
      "Enable enrichment as part of the V2 cutover.",
  );
}

/**
 * V1 adapter: the legacy engine consumes a flat `matchResult` with
 * `homeScore`, `awayScore`, `finalized`, `voided`, `status`, `result`.
 * This keeps V1 behavior intact when `SETTLEMENT_ENGINE !== "v2"`.
 */
function buildV1FixtureMatchResult(fixture) {
  if (!fixture) return null;
  const status = String(fixture.status || "").toUpperCase();
  const voided = VOID_FIXTURE_STATUSES.has(status);
  const finalized = FINAL_FIXTURE_STATUSES.has(status);
  return {
    homeScore: fixture.home_score,
    awayScore: fixture.away_score,
    finalized,
    voided,
    status,
    result: null,
  };
}

function buildV1MatchMatchResult(match) {
  if (!match) return null;
  return {
    homeScore: null,
    awayScore: null,
    finalized: match.status === "FINISHED",
    voided: false,
    status: match.status,
    result: match.result || null,
  };
}

function legMultiplier(selection) {
  if (selection.result === SELECTION_RESULT.VOID) return 1;
  return Number(selection.odds) || 1;
}

/**
 * Shadow-mode comparison writer. Never throws, never blocks.
 * Intentionally `prisma`-rooted (not `tx`) so a shadow miss never
 * aborts the live settlement transaction.
 */
async function recordShadowMismatch({
  selectionId,
  ticketId,
  marketCode,
  v1Result,
  v2Outcome,
}) {
  try {
    // AuditLog model is available via the main Prisma client.
    await prisma.auditLog.create({
      data: {
        action: "SETTLEMENT_SHADOW_MISMATCH",
        module: "SETTLEMENT",
        entity_type: "TICKET_SELECTION",
        entity_id: selectionId,
        before: { v1: { result: v1Result } },
        after: {
          v2: {
            result: v2Outcome.result,
            reason: v2Outcome.reason,
            engineVersion: v2Outcome.engineVersion,
            marketVersion: v2Outcome.marketVersion,
          },
        },
        meta: { ticketId, marketCode },
      },
    });
  } catch (err) {
    console.error(
      "[settlement/shadow] failed to record mismatch:",
      err?.message || err,
    );
  }
}

/**
 * Apply the canonical ticket recompute rules. The caller must run this
 * inside a Prisma `$transaction` because it mutates ticket rows.
 *
 * V2 semantics:
 *   - any leg LOST → ticket LOST (precedence, potential_win = 0)
 *   - all legs VOID → ticket VOID (stake refunded in
 *     `refundOnlineTicketInTx`)
 *   - all legs resolved (mix of WON + VOID) → ticket WON (VOID legs
 *     collapse to 1.0 multiplier)
 *   - else: unchanged
 *
 * @returns {Promise<{ status: string, transitioned: boolean, allVoid: boolean }>}
 */
export async function recomputeTicketStatus(tx, ticketId) {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    return { status: null, transitioned: false, allVoid: false };
  }
  if (!SETTLEABLE_TICKET_STATUSES.has(ticket.status)) {
    return { status: ticket.status, transitioned: false, allVoid: false };
  }

  const selections = await tx.ticketSelection.findMany({
    where: { ticket_id: ticketId },
  });
  if (!selections.length) {
    return { status: ticket.status, transitioned: false, allVoid: false };
  }

  const hasLost = selections.some((s) => s.result === SELECTION_RESULT.LOST);
  const hasPending = selections.some(
    (s) => s.result === SELECTION_RESULT.PENDING,
  );
  const allResolved = !hasPending;
  const allVoid = allResolved && selections.every(
    (s) => s.result === SELECTION_RESULT.VOID,
  );

  let nextStatus = ticket.status;
  if (hasLost) nextStatus = "LOST";
  else if (allVoid) nextStatus = "VOID";
  else if (allResolved) nextStatus = "WON";

  if (nextStatus === ticket.status) {
    return { status: ticket.status, transitioned: false, allVoid: false };
  }

  const newTotalOdds = selections.reduce(
    (acc, sel) => acc * legMultiplier(sel),
    1,
  );
  const stake = Number(ticket.stake) || 0;
  let newPotentialWin;
  if (nextStatus === "LOST") newPotentialWin = 0;
  else if (nextStatus === "VOID") newPotentialWin = stake; // full refund
  else {
    const acc = Number(ticket.accumulator_bonus_percent) || 0;
    newPotentialWin = Number(
      (stake * newTotalOdds * (1 + acc / 100)).toFixed(2),
    );
    const limits = await resolveBettingLimits(tx);
    newPotentialWin = capGrossPotentialWin(limits, newPotentialWin);
  }

  await tx.ticket.update({
    where: { id: ticket.id },
    data: {
      status: nextStatus,
      total_odds: Number(newTotalOdds.toFixed(4)),
      potential_win: newPotentialWin,
    },
  });

  return {
    status: nextStatus,
    transitioned: true,
    allVoid: nextStatus === "VOID",
  };
}

/**
 * Swallow Prisma's unique-constraint violation. Any other error
 * re-throws so it aborts the enclosing $transaction.
 */
function isUniqueConstraintError(err) {
  return err?.code === "P2002";
}

/**
 * Credit the player wallet when an online ticket transitions to WON.
 * No-op for cashier-printed tickets. Idempotent through the DB-level
 * `Transaction.reference @unique` constraint.
 */
export async function creditOnlineWinnerInTx(tx, ticketId) {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { skipped: true, reason: "ticket_not_found" };
  if (ticket.status !== "WON") return { skipped: true, reason: "not_won" };
  if (!ticket.user_id) return { skipped: true, reason: "no_user" };

  const cashierPrint = await tx.transaction.findFirst({
    where: { type: "BET", reference: `ticket-print:${ticket.id}` },
    select: { id: true },
  });
  if (cashierPrint) return { skipped: true, reason: "cashier_paid" };

  const settlementRef = `win-settlement:${ticket.id}`;
  const existing = await tx.transaction.findFirst({
    where: { reference: settlementRef },
    select: { id: true },
  });
  if (existing) return { skipped: true, reason: "already_credited" };

  const wallet = await tx.wallet.findFirst({
    where: { user_id: ticket.user_id, wallet_type: "PLAYER" },
  });
  if (!wallet) return { skipped: true, reason: "no_player_wallet" };

  const { netPayout: amount } = ticketWinningsTaxBreakdown(ticket);
  if (amount <= 0) return { skipped: true, reason: "non_positive_payout" };

  const beforeSnap = walletSnapshot(wallet);
  const credited = await creditWallet(tx, wallet, amount, {
    withdrawable: true,
  });
  try {
    await tx.transaction.create({
      data: {
        wallet_id: wallet.id,
        type: "PAYOUT",
        amount,
        balance_before: credited.balanceBefore,
        balance_after: credited.balanceAfter,
        reference: settlementRef,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      // Concurrent credit raced us — revert the balance bump because
      // the parallel writer already applied its own. This is safe
      // inside a Prisma $transaction: the wallet update rolls back on
      // the caller's failure path. To be defensive in Mongo (which
      // doesn't have true rollback on all Prisma paths), we restore
      // the balance explicitly here.
      await restoreWallet(tx, wallet, beforeSnap);
      return { skipped: true, reason: "already_credited_race" };
    }
    throw err;
  }
  await tx.ticket.update({
    where: { id: ticket.id },
    data: { status: "PAID" },
  });

  return {
    credited: amount,
    balanceAfter: credited.balanceAfter,
    reason: "credited",
  };
}

/**
 * Refund the stake on an online ticket that transitioned to VOID
 * (every leg was VOID). Idempotent through the unique
 * `bet-refund:<ticketId>` transaction reference.
 */
export async function refundOnlineTicketInTx(tx, ticketId) {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { skipped: true, reason: "ticket_not_found" };
  if (ticket.status !== "VOID") return { skipped: true, reason: "not_void" };
  if (!ticket.user_id) return { skipped: true, reason: "no_user" };

  // Cashier-printed tickets are refunded by the cashier flow (a
  // manual reverse of the `ticket-print:<id>` BET on the cashier
  // wallet). The online refund path skips them.
  const cashierPrint = await tx.transaction.findFirst({
    where: { type: "BET", reference: `ticket-print:${ticket.id}` },
    select: { id: true },
  });
  if (cashierPrint) return { skipped: true, reason: "cashier_handled" };

  const refundRef = `bet-refund:${ticket.id}`;
  const existing = await tx.transaction.findFirst({
    where: { reference: refundRef },
    select: { id: true },
  });
  if (existing) return { skipped: true, reason: "already_refunded" };

  const wallet = await tx.wallet.findFirst({
    where: { user_id: ticket.user_id, wallet_type: "PLAYER" },
  });
  if (!wallet) return { skipped: true, reason: "no_player_wallet" };

  const amount = Number(ticket.stake) || 0;
  if (amount <= 0) return { skipped: true, reason: "non_positive_stake" };

  const beforeSnap = walletSnapshot(wallet);
  const credited = await creditWallet(tx, wallet, amount, {
    withdrawable: false,
  });
  try {
    await tx.transaction.create({
      data: {
        wallet_id: wallet.id,
        type: "DEPOSIT",
        amount,
        balance_before: credited.balanceBefore,
        balance_after: credited.balanceAfter,
        reference: refundRef,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      await restoreWallet(tx, wallet, beforeSnap);
      return { skipped: true, reason: "already_refunded_race" };
    }
    throw err;
  }

  return {
    refunded: amount,
    balanceAfter: credited.balanceAfter,
    reason: "refunded",
  };
}

function mergeLegResult(selection, v1Outcome, v2Outcome) {
  // V1 returns `{ result, reason? }`; V2 returns `{ result, reason,
  // engineVersion, marketVersion }`. We return the chosen outcome
  // plus a `result_meta` payload to persist for audit.
  const live = useV2Engine() ? v2Outcome : v1Outcome;
  const shadow = useShadow() ? (useV2Engine() ? v1Outcome : v2Outcome) : null;
  return {
    result: live?.result || SELECTION_RESULT.PENDING,
    reason: live?.reason || null,
    meta: {
      engine: useV2Engine() ? "v2" : "v1",
      reason: live?.reason || null,
      engineVersion: live?.engineVersion ?? null,
      marketVersion: live?.marketVersion ?? null,
      shadow: shadow
        ? {
            engine: useV2Engine() ? "v1" : "v2",
            result: shadow.result,
            reason: shadow.reason || null,
          }
        : null,
    },
  };
}

async function gradeSelectionsInTx(tx, selections, matchResults, marketResultOverrides, context = {}) {
  const ticketIds = new Set();
  const ungraded = [];
  let updated = 0;
  let pendingAfter = 0;
  for (const sel of selections) {
    if (sel.result !== SELECTION_RESULT.PENDING) {
      ticketIds.add(sel.ticket_id);
      continue;
    }

    const overrideOutcome = gradeSelectionWithOverride(
      sel,
      marketResultOverrides,
    );

    let v1Outcome = null;
    let v2Outcome = null;
    if (overrideOutcome) {
      v1Outcome = overrideOutcome;
      v2Outcome = overrideOutcome;
    } else {
      if (!useV2Engine() || useShadow()) {
        v1Outcome = evaluateSelectionV1(sel, matchResults.v1);
      }
      if (useV2Engine() || useShadow()) {
        v2Outcome = evaluateSelectionV2(sel, matchResults.v2);
      }
    }

    const merged = mergeLegResult(sel, v1Outcome, v2Outcome);

    // FAIL-CLOSED on absent provider data: a leg that VOIDs for
    // `missing_required_data` (stats/events not present) on a fixture that was
    // never successfully enriched (resultVersion === 0) is NOT a real void — the
    // data simply hasn't arrived yet (delayed stats ~5-15 min post-FT, or an
    // outage/quota `[]`). Demote it to PENDING so settlementRetry re-enriches and
    // re-grades, instead of permanently refunding a market we CAN settle once
    // data lands. Once enriched (resultVersion > 0) a genuine missing-data void
    // stands (e.g. a league that truly never reports corners).
    const v2Ver = Number(matchResults?.v2?.resultVersion) || 0;
    if (
      merged.result === SELECTION_RESULT.VOID &&
      merged.reason === "missing_required_data" &&
      v2Ver === 0
    ) {
      ticketIds.add(sel.ticket_id);
      pendingAfter++;
      ungraded.push({
        selectionId: sel.id,
        ticketId: sel.ticket_id,
        marketCode: sel.market_code || null,
        selection: sel.selection || null,
        reason: "awaiting_enrichment",
      });
      recordUngradedLeg({ marketCode: sel.market_code || "unknown" });
      continue;
    }

    // Shadow mismatch detection (never mutates ticket outcomes).
    if (useShadow() && v1Outcome && v2Outcome && v1Outcome.result !== v2Outcome.result) {
      await recordShadowMismatch({
        selectionId: sel.id,
        ticketId: sel.ticket_id,
        marketCode: sel.market_code,
        v1Result: v1Outcome.result,
        v2Outcome,
      });
    }

    if (!merged.result || merged.result === SELECTION_RESULT.PENDING) {
      // The fixture/match is already terminal by the time we grade, so a leg
      // left PENDING means the active engine can't decide this market (V1 only
      // grades 5 markets → `unknown_market`). Record it so the silent
      // stuck-pending bug becomes a metric + audit row, not an invisible hang.
      ticketIds.add(sel.ticket_id);
      pendingAfter++;
      ungraded.push({
        selectionId: sel.id,
        ticketId: sel.ticket_id,
        marketCode: sel.market_code || null,
        selection: sel.selection || null,
        reason: merged.reason || "pending",
      });
      recordUngradedLeg({ marketCode: sel.market_code || "unknown" });
      continue;
    }

    const updateData = {
      result: merged.result,
      result_meta: merged.meta,
    };
    if (merged.meta?.marketVersion != null) {
      updateData.market_version = merged.meta.marketVersion;
    }
    await tx.ticketSelection.update({
      where: { id: sel.id },
      data: updateData,
    });
    ticketIds.add(sel.ticket_id);
    updated++;
  }

  if (ungraded.length) {
    const byMarket = {};
    for (const leg of ungraded) {
      const code = leg.marketCode || "unknown";
      byMarket[code] = (byMarket[code] || 0) + 1;
    }
    console.warn(
      `[settlement] ungraded_legs engine=${useV2Engine() ? "v2" : "v1"} ` +
        `context=${context.kind || "?"}:${context.id || "?"} ` +
        `count=${ungraded.length} byMarket=${JSON.stringify(byMarket)}`,
    );
    // Fire-and-forget (prisma-rooted inside logAuditEvent) so an audit-write
    // failure never aborts the settlement transaction.
    logAuditEvent({
      action: "SETTLEMENT_UNGRADED_LEGS",
      module: "SETTLEMENT",
      entityType: context.kind === "MATCH" ? "MATCH" : "FIXTURE",
      entityId: context.id || null,
      before: null,
      after: {
        engine: useV2Engine() ? "v2" : "v1",
        count: ungraded.length,
        byMarket,
        legs: ungraded.slice(0, 50),
      },
    }).catch(() => {});
  }

  return { ticketIds, updated, pendingAfter };
}

async function recomputeAndCreditTickets(tx, ticketIds) {
  let ticketsWon = 0;
  let ticketsLost = 0;
  let ticketsVoided = 0;
  let payoutsCredited = 0;
  let refundsIssued = 0;
  for (const ticketId of ticketIds) {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || TERMINAL_TICKET_STATUSES.has(ticket.status)) {
      if (ticket?.status === "WON" || ticket?.status === "PAID") {
        const credit = await creditOnlineWinnerInTx(tx, ticketId);
        if (credit.credited) payoutsCredited++;
      }
      if (ticket?.status === "VOID") {
        const refund = await refundOnlineTicketInTx(tx, ticketId);
        if (refund.refunded) refundsIssued++;
      }
      if (ticket?.status === "LOST") {
        // Already LOST on an earlier leg; a now-graded leg may have been
        // the last pending one. Cashback defers until all legs resolve
        // (see creditCashbackOnLostTicketInTx) and is idempotent.
        await creditCashbackOnLostTicketInTx(tx, ticketId);
      }
      continue;
    }
    const { status, transitioned } = await recomputeTicketStatus(tx, ticketId);
    if (!transitioned) continue;

    logAuditEvent({
      action: `TICKET_SETTLEMENT_${status}`,
      module: "SETTLEMENT",
      entityType: "TICKET",
      entityId: ticketId,
      before: { status: ticket.status },
      after: { status },
    }).catch(() => {});

    if (status === "WON") {
      ticketsWon++;
      const credit = await creditOnlineWinnerInTx(tx, ticketId);
      if (credit.credited) payoutsCredited++;
    } else if (status === "LOST") {
      ticketsLost++;
      await creditCashbackOnLostTicketInTx(tx, ticketId);
    } else if (status === "VOID") {
      ticketsVoided++;
      const refund = await refundOnlineTicketInTx(tx, ticketId);
      if (refund.refunded) refundsIssued++;
    }
  }
  return {
    ticketsWon,
    ticketsLost,
    ticketsVoided,
    payoutsCredited,
    refundsIssued,
  };
}

/**
 * Settle every selection on a fixture. Idempotent through
 * `Fixture.grading_completed_at`. `settled_at` is written on every
 * run (so we record last-attempt time) but does NOT short-circuit on
 * its own — the retry job relies on `grading_completed_at` being
 * null when pending legs remain.
 *
 * @param {string} fixtureId
 * @param {{ force?: boolean, resetLegs?: boolean }} options
 *   `force` bypasses the `grading_completed_at` skip gate.
 *   `resetLegs` resets every leg on the fixture to PENDING before
 *   grading (admin market-result override path).
 */
export async function settleFixture(fixtureId, options = {}) {
  if (!fixtureId) return { skipped: true, reason: "missing_fixture_id" };
  console.log(
    `[settlement] start fixture=${fixtureId} force=${!!options.force}`,
  );
  try {
    const result = await prisma.$transaction(async (tx) => {
      const fixture = await tx.fixture.findUnique({
        where: { id: fixtureId },
      });
      if (!fixture) return { skipped: true, reason: "fixture_not_found" };

      if (fixture.grading_completed_at && !options.force) {
        return {
          skipped: true,
          reason: "already_settled",
          settledAt: fixture.grading_completed_at,
        };
      }
      if (!isTerminalFixtureStatus(fixture.status)) {
        return {
          skipped: true,
          reason: "not_terminal",
          status: fixture.status,
        };
      }

      const matchResults = {
        v1: buildV1FixtureMatchResult(fixture),
        v2: buildMatchResultV2FromFixture(fixture),
      };

      if (options.resetLegs) {
        await tx.ticketSelection.updateMany({
          where: { fixture_id: fixtureId },
          data: { result: SELECTION_RESULT.PENDING, result_meta: null },
        });
        await tx.fixture.update({
          where: { id: fixtureId },
          data: { grading_completed_at: null },
        });
      }

      const selections = await tx.ticketSelection.findMany({
        where: { fixture_id: fixtureId },
      });

      const { ticketIds, updated, pendingAfter } = await gradeSelectionsInTx(
        tx,
        selections,
        matchResults,
        fixture.market_result_overrides,
        { kind: "FIXTURE", id: fixtureId },
      );
      const {
        ticketsWon,
        ticketsLost,
        ticketsVoided,
        payoutsCredited,
        refundsIssued,
      } = await recomputeAndCreditTickets(tx, ticketIds);

      const remaining = await tx.ticketSelection.count({
        where: { fixture_id: fixtureId, result: SELECTION_RESULT.PENDING },
      });

      const updateData = {
        settled_at: new Date(),
        settled_status: fixture.status,
      };
      if (remaining === 0) updateData.grading_completed_at = new Date();

      await tx.fixture.update({
        where: { id: fixtureId },
        data: updateData,
      });

      return {
        fixtureId,
        status: fixture.status,
        voided: VOID_FIXTURE_STATUSES.has(
          String(fixture.status || "").toUpperCase(),
        ),
        finalized: FINAL_FIXTURE_STATUSES.has(
          String(fixture.status || "").toUpperCase(),
        ),
        selectionsUpdated: updated,
        pendingLegsRemaining: remaining,
        gradingCompleted: remaining === 0,
        ticketsAffected: ticketIds.size,
        ticketsWon,
        ticketsLost,
        ticketsVoided,
        payoutsCredited,
        refundsIssued,
        engine: useV2Engine() ? "v2" : "v1",
        shadow: useShadow() ? (useV2Engine() ? "v1" : "v2") : null,
        engineVersion: useV2Engine() ? V2_ENGINE_VERSION : 1,
      };
    });
    if (!result.skipped) {
      console.log(
        `[settlement] completed fixture=${fixtureId} status=${result.status} graded=${result.selectionsUpdated} pending=${result.pendingLegsRemaining} won=${result.ticketsWon} lost=${result.ticketsLost} voided=${result.ticketsVoided} payouts=${result.payoutsCredited} refunds=${result.refundsIssued}`,
      );
    } else {
      console.log(
        `[settlement] skipped fixture=${fixtureId} reason=${result.reason}`,
      );
    }
    return result;
  } catch (err) {
    console.error(
      `[settlement] FAILED fixture=${fixtureId}:`,
      err?.message || err,
    );
    throw err;
  }
}

/**
 * Settle every selection on an admin-managed Match. Used by the manual
 * override endpoint. Idempotent through `Match.settled_at`.
 */
export async function settleMatch(matchId, resultString, options = {}) {
  if (!matchId) return { skipped: true, reason: "missing_match_id" };
  const trimmedResult =
    typeof resultString === "string" && resultString.trim()
      ? resultString.trim()
      : null;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.match.findUnique({ where: { id: matchId } });
    if (!existing) return { skipped: true, reason: "match_not_found" };

    if (existing.settled_at && !options.force) {
      return {
        skipped: true,
        reason: "already_settled",
        settledAt: existing.settled_at,
      };
    }

    const match = await tx.match.update({
      where: { id: matchId },
      data: {
        result: trimmedResult ?? existing.result,
        status: "FINISHED",
      },
    });

    const matchResults = {
      v1: buildV1MatchMatchResult(match),
      v2: buildMatchResultV2FromMatch(match),
    };

    const selections = await tx.ticketSelection.findMany({
      where: { match_id: matchId },
    });

    const { ticketIds, updated } = await gradeSelectionsInTx(
      tx,
      selections,
      matchResults,
      undefined,
      { kind: "MATCH", id: matchId },
    );
    const {
      ticketsWon,
      ticketsLost,
      ticketsVoided,
      payoutsCredited,
      refundsIssued,
    } = await recomputeAndCreditTickets(tx, ticketIds);

    await tx.match.update({
      where: { id: matchId },
      data: { settled_at: new Date() },
    });

    return {
      matchId,
      result: matchResults.v2.resultLabel,
      selectionsUpdated: updated,
      ticketsAffected: ticketIds.size,
      ticketsWon,
      ticketsLost,
      ticketsVoided,
      payoutsCredited,
      refundsIssued,
      engine: useV2Engine() ? "v2" : "v1",
      shadow: useShadow() ? (useV2Engine() ? "v1" : "v2") : null,
    };
  });
}
