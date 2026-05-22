import { resolveCashoutMargin } from "../lib/cashoutMargin.js";
import { computeWinningsTaxBreakdown } from "../lib/winningsTax.js";

const ELIGIBLE_TICKET_STATUSES = new Set(["OPEN", "PRINTED"]);
const TERMINAL_TICKET_STATUSES = new Set([
  "WON",
  "LOST",
  "PAID",
  "VOID",
  "CANCELED",
  "CASHED_OUT",
]);

const FINAL_FIXTURE_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);
const VOID_FIXTURE_STATUSES = new Set(["CANC", "ABD", "PST"]);
const LIVE_FIXTURE_STATUSES = new Set([
  "LIVE",
  "1H",
  "HT",
  "2H",
  "ET",
  "BT",
  "P",
  "INT",
]);

function toMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeTicketStatus(status) {
  return String(status || "").toUpperCase();
}

function fixtureInfo(selection) {
  const status = String(selection?.fixture?.status || "").toUpperCase();
  const pending = !FINAL_FIXTURE_STATUSES.has(status) && !VOID_FIXTURE_STATUSES.has(status);
  const live = LIVE_FIXTURE_STATUSES.has(status);
  const suspended = status === "SUSP";
  const finished = FINAL_FIXTURE_STATUSES.has(status) || VOID_FIXTURE_STATUSES.has(status);
  return {
    pending,
    live,
    suspended,
    finished,
    time: selection?.fixture?.start_time ?? null,
  };
}

function matchInfo(selection) {
  const status = String(selection?.match?.status || "").toUpperCase();
  return {
    pending: status === "NOT_STARTED" || status === "LIVE",
    live: status === "LIVE",
    suspended: status === "SUSPENDED",
    finished: status === "FINISHED",
    time: selection?.match?.start_time ?? null,
  };
}

function selectionState(selection) {
  const result = String(selection?.result || "PENDING").toUpperCase();
  if (result === "LOST") return { won: false, lost: true, pending: false };
  if (result === "WON") return { won: true, lost: false, pending: false };
  return { won: false, lost: false, pending: true };
}

function selectionFacts(selection) {
  const source = selection?.fixture ? fixtureInfo(selection) : matchInfo(selection);
  const state = selectionState(selection);
  return {
    ...state,
    live: source.live,
    suspended: source.suspended,
    finished: source.finished,
    pendingByGameState: source.pending,
    settledTime: source.time,
    hasOdds: Number.isFinite(Number(selection?.odds)) && Number(selection?.odds) > 0,
  };
}

function baseEligibility(ticketStatus, facts) {
  if (!ELIGIBLE_TICKET_STATUSES.has(ticketStatus)) {
    return { allowed: false, reasonCode: "ticket_status_not_cashoutable" };
  }
  if (TERMINAL_TICKET_STATUSES.has(ticketStatus)) {
    return { allowed: false, reasonCode: "ticket_already_settled" };
  }
  if (!facts.every((f) => f.hasOdds)) {
    return { allowed: false, reasonCode: "missing_selection_odds" };
  }
  if (facts.some((f) => f.lost)) {
    return { allowed: false, reasonCode: "ticket_has_lost_selection" };
  }
  if (facts.some((f) => f.suspended)) {
    return { allowed: false, reasonCode: "match_suspended" };
  }
  return { allowed: true, reasonCode: "ok" };
}

function evaluateStandardProfile(facts) {
  const wonCount = facts.filter((f) => f.won).length;
  if (wonCount < 1) return { allowed: false, reasonCode: "minimum_won_not_met" };

  const hasOpenLeg = facts.some((f) => f.pending || f.pendingByGameState);
  if (!hasOpenLeg) {
    return { allowed: false, reasonCode: "no_ongoing_matches" };
  }
  return { allowed: true, reasonCode: "ok" };
}

function evaluateCashierProfile(facts, now = new Date()) {
  const wonCount = facts.filter((f) => f.won).length;
  if (wonCount < 3) return { allowed: false, reasonCode: "minimum_won_not_met" };
  if (facts.some((f) => f.live)) return { allowed: false, reasonCode: "live_match_present" };
  if (facts.some((f) => f.pending || f.pendingByGameState)) {
    return { allowed: false, reasonCode: "all_matches_must_finish" };
  }

  const settledTimes = facts
    .map((f) => (f.settledTime ? new Date(f.settledTime).getTime() : null))
    .filter((ms) => Number.isFinite(ms));
  if (settledTimes.length === 0) {
    return { allowed: false, reasonCode: "missing_match_end_time" };
  }

  const lastEndMs = Math.max(...settledTimes);
  const readyAt = lastEndMs + 30 * 60 * 1000;
  if (now.getTime() < readyAt) {
    return { allowed: false, reasonCode: "cooldown_not_elapsed" };
  }
  return { allowed: true, reasonCode: "ok" };
}

export function computeCashoutAmount({ stake, selections, margin }) {
  const wonOdds = (selections || [])
    .filter((selection) => String(selection?.result || "").toUpperCase() === "WON")
    .map((selection) => Number(selection.odds) || 1);
  const currentOdds = wonOdds.length > 0 ? wonOdds.reduce((acc, n) => acc * n, 1) : 0;
  const amount = toMoney((Number(stake) || 0) * currentOdds * (Number(margin) || 0));
  return { amount, currentOdds: toMoney(currentOdds) };
}

export function evaluateCashoutEligibility(ticket, { profile = "STANDARD", now = new Date() } = {}) {
  const ticketStatus = normalizeTicketStatus(ticket?.status);
  const selections = Array.isArray(ticket?.selections) ? ticket.selections : [];
  if (selections.length === 0) {
    return { allowed: false, reasonCode: "ticket_has_no_selections" };
  }

  const facts = selections.map(selectionFacts);
  const base = baseEligibility(ticketStatus, facts);
  if (!base.allowed) return base;

  if (profile === "CASHIER_OFFLINE") {
    return evaluateCashierProfile(facts, now);
  }
  return evaluateStandardProfile(facts);
}

export async function loadTicketForCashout(prismaClient, ticketId) {
  return prismaClient.ticket.findUnique({
    where: { id: ticketId },
    include: {
      selections: {
        include: {
          fixture: true,
          match: true,
        },
      },
      cashout: true,
      user: {
        include: {
          wallets: true,
        },
      },
      cashier: {
        include: {
          wallet: true,
        },
      },
    },
  });
}

export async function buildCashoutQuote(prismaClient, ticket, { now = new Date() } = {}) {
  const margin = await resolveCashoutMargin(prismaClient);
  const profile = ticket?.cashier_id ? "CASHIER_OFFLINE" : "STANDARD";
  const eligibility = evaluateCashoutEligibility(ticket, { profile, now });
  const breakdown = computeCashoutAmount({
    stake: Number(ticket?.stake || 0),
    selections: ticket?.selections || [],
    margin,
  });

  const grossOffer = breakdown.amount;
  const taxApplied = computeWinningsTaxBreakdown(
    grossOffer,
    Boolean(ticket?.apply_winnings_tax),
    ticket?.winnings_tax_rate,
  );
  const netAmount = taxApplied.netPayout;

  return {
    allowed: eligibility.allowed,
    reasonCode: eligibility.reasonCode,
    profile,
    amount: netAmount,
    breakdown: {
      stake: Number(ticket?.stake || 0),
      currentOdds: breakdown.currentOdds,
      margin,
      grossOffer,
      taxWithheld: taxApplied.taxAmount,
      netAmount,
    },
  };
}
