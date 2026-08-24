/**
 * Bonus rules engine — amounts, accumulator tiers, deposit stacking, idempotent BONUS ledger posts.
 *
 * Stacking: on a user's first successful deposit, FIRST_DEPOSIT and DEPOSIT configs
 * do not stack; the larger of the two computed amounts is credited once (reference
 * `bonus:deposit-tx:<depositTransactionId>`). Later deposits use DEPOSIT only.
 *
 * Welcome: `rules.fixedAmount` if set, else `percentage` is treated as a flat currency amount.
 *
 * @module lib/bonusEngine
 */
import { toMoney, d } from "./moneyDecimal.js";
import {
  creditWallet,
  restoreWallet,
  walletSnapshot,
} from "./walletBalance.js";

/** @param {string} userId */
export function welcomeBonusRef(userId) {
  return `bonus:welcome:${userId}`;
}

/** @param {string} depositTxId */
export function depositBonusRef(depositTxId) {
  return `bonus:deposit-tx:${depositTxId}`;
}

/** @param {string} ticketId */
export function cashbackBonusRef(ticketId) {
  return `bonus:cashback:${ticketId}`;
}

/** Fixture feed statuses that void a ticket's cashback eligibility. */
export const DEFAULT_DISQUALIFY_FIXTURE_STATUSES = ["PST", "CANC", "ABD"];
/** Admin-managed Match statuses that void a ticket's cashback eligibility. */
export const DEFAULT_DISQUALIFY_MATCH_STATUSES = ["SUSPENDED"];

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} db
 * @param {import("@prisma/client").BonusType} type
 */
export async function getActiveBonus(db, type) {
  return db.bonus.findFirst({
    where: { type, status: true },
    orderBy: { created_at: "desc" },
  });
}

/**
 * @param {import("@prisma/client").Bonus | null} bonus
 */
export function computeWelcomeFlatAmount(bonus) {
  if (!bonus || bonus.type !== "WELCOME" || !bonus.status) return 0;
  const rules =
    bonus.rules && typeof bonus.rules === "object" ? bonus.rules : {};
  const fixed = rules.fixedAmount;
  if (typeof fixed === "number" && Number.isFinite(fixed) && fixed > 0) {
    return roundMoney(fixed);
  }
  const pct = Number(bonus.percentage);
  if (Number.isFinite(pct) && pct > 0) return roundMoney(pct);
  return 0;
}

/**
 * @param {import("@prisma/client").Bonus | null} bonus
 * @param {number} depositAmount
 */
export function computeDepositBonusPercentAmount(bonus, depositAmount) {
  if (!bonus || !bonus.status) return 0;
  const min =
    bonus.min_deposit != null ? Number(bonus.min_deposit) : 0;
  if (!Number.isFinite(depositAmount) || depositAmount < min) return 0;
  const p = Number(bonus.percentage);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return roundMoney((depositAmount * p) / 100);
}

/**
 * First deposit: max(FIRST_DEPOSIT, DEPOSIT). Subsequent: DEPOSIT only.
 *
 * @param {import("@prisma/client").Bonus | null} firstDepositBonus
 * @param {import("@prisma/client").Bonus | null} depositBonus
 * @param {number} depositAmount
 * @param {boolean} isFirstDeposit
 */
export function computeStackedDepositBonusAmount(
  firstDepositBonus,
  depositBonus,
  depositAmount,
  isFirstDeposit,
) {
  if (!Number.isFinite(depositAmount) || depositAmount <= 0) return 0;
  if (isFirstDeposit) {
    const a = computeDepositBonusPercentAmount(firstDepositBonus, depositAmount);
    const b = computeDepositBonusPercentAmount(depositBonus, depositAmount);
    return roundMoney(Math.max(a, b));
  }
  return computeDepositBonusPercentAmount(depositBonus, depositAmount);
}

/**
 * Highest matching tier wins.
 *
 * @param {import("@prisma/client").Bonus | null} bonus
 * @param {number} legCount
 */
export function computeAccumulatorPercent(bonus, legCount) {
  if (!bonus || bonus.type !== "ACCUMULATOR" || !bonus.status) return 0;
  const n = Number(legCount);
  if (!Number.isFinite(n) || n < 1) return 0;
  const rules =
    bonus.rules && typeof bonus.rules === "object" ? bonus.rules : {};
  const tiers = Array.isArray(rules.tiers) ? rules.tiers : [];
  let best = 0;
  for (const t of tiers) {
    const minL = Number(t.minLegs);
    const bp = Number(t.bonusPercent);
    if (!Number.isFinite(minL) || !Number.isFinite(bp)) continue;
    if (n >= minL && bp > best) best = bp;
  }
  if (best === 0 && tiers.length === 0) {
    const p = Number(bonus.percentage);
    if (Number.isFinite(p) && p > 0 && n >= 2) return p;
  }
  return best;
}

/**
 * @param {number} stake
 * @param {number} totalOdds
 * @param {number} accumulatorPercent
 */
export function potentialWinWithAccumulator(stake, totalOdds, accumulatorPercent) {
  const s = Number(stake);
  const o = Number(totalOdds);
  const p = Number(accumulatorPercent) || 0;
  if (!Number.isFinite(s) || !Number.isFinite(o)) return 0;
  return toMoney(d(s).mul(d(o)).mul(d(1).add(d(p).div(100))));
}

export function roundMoney(x) {
  return toMoney(x);
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} db
 * @param {number} legCount
 * @param {number} stake
 * @param {number} totalOdds
 */
export async function resolveAccumulatorForNewTicket(db, legCount, stake, totalOdds) {
  const bonus = await getActiveBonus(db, "ACCUMULATOR");
  const pct = computeAccumulatorPercent(bonus, legCount);
  const potentialWin = potentialWinWithAccumulator(stake, totalOdds, pct);
  return {
    accumulator_bonus_percent: pct,
    potential_win: potentialWin,
  };
}

/**
 * Pick the cashback tier matching `result`. Ranges are inclusive on both
 * ends; a tier with `maxResult == null` is open-ended (matches everything
 * at or above its `minResult`).
 *
 * Configured ranges use whole numbers (20–44, 45–79, …) while `result` is a
 * ratio of odds, so a value such as 44.6 falls between two tiers. Tiers are
 * treated as lower bounds in that case: the highest tier whose `minResult`
 * the value clears wins, which rounds the customer down to the band they
 * fully reached instead of denying the payout.
 *
 * @param {number} result
 * @param {Array<{ minResult: number, maxResult: number | null, stakeMultiplier: number }>} tiers
 */
export function pickCashbackTier(result, tiers) {
  if (!Array.isArray(tiers)) return null;
  const r = Number(result);
  if (!Number.isFinite(r)) return null;

  const normalize = (t) => {
    if (!t || typeof t !== "object") return null;
    const min = Number(t.minResult);
    const mult = Number(t.stakeMultiplier);
    if (!Number.isFinite(min) || !Number.isFinite(mult)) return null;
    const max = t.maxResult == null ? Infinity : Number(t.maxResult);
    if (Number.isNaN(max)) return null;
    return {
      minResult: min,
      maxResult: t.maxResult == null ? null : max,
      stakeMultiplier: mult,
      max,
    };
  };

  let fallback = null;
  for (const raw of tiers) {
    const t = normalize(raw);
    if (!t) continue;
    if (r >= t.minResult && r <= t.max) {
      const { max, ...tier } = t;
      return tier;
    }
    if (r > t.max && (!fallback || t.minResult > fallback.minResult)) {
      fallback = t;
    }
  }
  if (!fallback) return null;
  const { max, ...tier } = fallback;
  return tier;
}

/**
 * Odds the ticket was sold at. Settlement rewrites `Ticket.total_odds` when a
 * ticket resolves, collapsing VOID legs to a 1.0 multiplier, so the stored
 * value is smaller than what the customer bought. Cashback tiers are priced
 * off the sold odds, so rebuild them from the legs' locked odds whenever a
 * VOID leg is present.
 *
 * @param {import("@prisma/client").Ticket} ticket
 * @param {Array<{ result?: string, odds?: number }>} selections
 */
function placementTotalOdds(ticket, selections) {
  const stored = Number(ticket.total_odds);
  if (!Array.isArray(selections) || selections.length === 0) return stored;
  const hasVoidLeg = selections.some(
    (s) => s && String(s.result ?? "").toUpperCase() === "VOID",
  );
  if (!hasVoidLeg) return stored;

  let product = 1;
  for (const sel of selections) {
    const o = Number(sel?.odds);
    if (!Number.isFinite(o) || o <= 0) return stored;
    product *= o;
  }
  return product > stored ? product : stored;
}

function cashbackFail(reason, extra = {}) {
  return {
    eligible: false,
    amount: 0,
    reason,
    result: extra.result ?? null,
    tier: extra.tier ?? null,
    profileKey: extra.profileKey ?? null,
  };
}

function outsideCashbackWindow(ticket, now, maxHours) {
  const hours = Number(maxHours ?? 0);
  if (!Number.isFinite(hours) || hours <= 0 || !ticket.created_at) return false;
  const created = new Date(ticket.created_at).getTime();
  const settledAt = new Date(now).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(settledAt)) return false;
  return (settledAt - created) / MS_PER_HOUR > hours;
}

function hasDisqualifiedCashbackLeg(rules, fixtureStatuses, matchStatuses) {
  const fixtureDq = Array.isArray(rules.disqualifyFixtureStatuses)
    ? rules.disqualifyFixtureStatuses
    : DEFAULT_DISQUALIFY_FIXTURE_STATUSES;
  const matchDq = Array.isArray(rules.disqualifyMatchStatuses)
    ? rules.disqualifyMatchStatuses
    : DEFAULT_DISQUALIFY_MATCH_STATUSES;
  const fixtureDqSet = new Set(fixtureDq.map((s) => String(s).toUpperCase()));
  const matchDqSet = new Set(matchDq.map((s) => String(s).toUpperCase()));
  const hasDqFixture = fixtureStatuses.some(
    (s) => s && fixtureDqSet.has(String(s).toUpperCase()),
  );
  const hasDqMatch = matchStatuses.some(
    (s) => s && matchDqSet.has(String(s).toUpperCase()),
  );
  return hasDqFixture || hasDqMatch;
}

function collectLostLegs(selections) {
  const lost = [];
  for (const sel of selections) {
    if (!sel) continue;
    if (String(sel.result ?? "").toUpperCase() !== "LOST") continue;
    const o = Number(sel.odds);
    if (Number.isFinite(o) && o > 0) lost.push(o);
  }
  return lost;
}

function ticketHasLiveLeg(ticket, selections) {
  if (String(ticket?.channel ?? "").toUpperCase() === "LIVE") return true;
  return selections.some((s) => s && s.live_at_placement === true);
}

function defaultProfileKey(lostLegCount, profile) {
  if (profile?.key) return String(profile.key);
  if (lostLegCount === 1) return "oneLoss";
  if (lostLegCount === 2) return "twoLoss";
  return null;
}

/**
 * v3: two (or more) loss-count profiles. `result = sold total odds / sum
 * of lost-leg odds`. `minLegs` is inclusive (>=).
 */
function evaluateCashbackProfiles({
  ticket,
  selections,
  fixtureStatuses,
  matchStatuses,
  rules,
  now,
  isOnline,
}) {
  const stake = Number(ticket.stake);
  if (!Number.isFinite(stake) || stake <= 0) {
    return cashbackFail("invalid_stake");
  }

  const lostOdds = collectLostLegs(selections);
  if (lostOdds.length === 0) return cashbackFail("no_lost_leg");

  const profiles = Array.isArray(rules.profiles) ? rules.profiles : [];
  const profile = profiles.find((p) => Number(p?.lostLegs) === lostOdds.length);
  if (!profile) {
    return cashbackFail(
      lostOdds.length >= 3 ? "too_many_lost_legs" : "no_matching_profile",
    );
  }
  const profileKey = defaultProfileKey(lostOdds.length, profile);
  const fail = (reason, extra = {}) =>
    cashbackFail(reason, { profileKey, ...extra });

  const selectionCount = Array.isArray(selections) ? selections.length : 0;
  const minLegs = Number(profile.minLegs ?? 0);
  if (Number.isFinite(minLegs) && minLegs > 0 && selectionCount < minLegs) {
    return fail("too_few_selections");
  }

  const minLegOdds = Number(profile.minLegOdds ?? 0);
  if (Number.isFinite(minLegOdds) && minLegOdds > 0) {
    const below = selections.some((s) => {
      if (!s) return true;
      const o = Number(s.odds);
      return !Number.isFinite(o) || !(o > minLegOdds);
    });
    if (below) return fail("leg_odds_below_min");
  }

  const minStake = Number(
    isOnline
      ? (profile.minStakeOnline ?? 0)
      : (profile.minStakeOffline ?? 0),
  );
  if (Number.isFinite(minStake) && minStake > 0 && stake < minStake) {
    return fail("below_min_stake");
  }

  if (outsideCashbackWindow(ticket, now, rules.maxHours)) {
    return fail("outside_time_window");
  }

  if (hasDisqualifiedCashbackLeg(rules, fixtureStatuses, matchStatuses)) {
    return fail("disqualified_selection");
  }

  const excludeLive = rules.excludeLiveForOnline !== false;
  if (isOnline && excludeLive && ticketHasLiveLeg(ticket, selections)) {
    return fail("live_leg_excluded");
  }

  const lostOddsSum = lostOdds.reduce((acc, o) => acc + o, 0);
  if (!(lostOddsSum > 0)) return fail("no_lost_leg");

  const totalOdds = placementTotalOdds(ticket, selections);
  if (!Number.isFinite(totalOdds) || totalOdds <= 0) {
    return fail("invalid_total_odds");
  }

  const result = totalOdds / lostOddsSum;
  const minResult = Number(profile.minResult ?? 0);
  if (Number.isFinite(minResult) && minResult > 0 && result < minResult) {
    return fail("below_min_result", { result });
  }

  const tiers = Array.isArray(profile.tiers) ? profile.tiers : [];
  if (tiers.length === 0) return fail("no_tiers");

  const tier = pickCashbackTier(result, tiers);
  if (!tier) return fail("no_matching_tier", { result });

  const amount = roundMoney(stake * tier.stakeMultiplier);
  if (!(amount > 0)) return fail("non_positive_amount", { result, tier });

  return { eligible: true, amount, reason: "eligible", result, tier, profileKey };
}

/**
 * v2 single-track: `result = total_odds / largestLostLegOdds`.
 * `minSelections` means strictly greater than.
 */
function evaluateCashbackV2({
  ticket,
  selections,
  fixtureStatuses,
  matchStatuses,
  rules,
  now,
}) {
  const tiers = Array.isArray(rules.tiers) ? rules.tiers : [];
  if (tiers.length === 0) return cashbackFail("no_tiers");

  const stake = Number(ticket.stake);
  if (!Number.isFinite(stake) || stake <= 0) return cashbackFail("invalid_stake");

  const minStake = Number(rules.minStake ?? 0);
  if (Number.isFinite(minStake) && minStake > 0 && stake < minStake) {
    return cashbackFail("below_min_stake");
  }

  const minSelections = Number(rules.minSelections ?? 0);
  const selectionCount = Array.isArray(selections) ? selections.length : 0;
  if (
    Number.isFinite(minSelections) &&
    minSelections > 0 &&
    !(selectionCount > minSelections)
  ) {
    return cashbackFail("too_few_selections");
  }

  if (outsideCashbackWindow(ticket, now, rules.maxHours)) {
    return cashbackFail("outside_time_window");
  }

  if (hasDisqualifiedCashbackLeg(rules, fixtureStatuses, matchStatuses)) {
    return cashbackFail("disqualified_selection");
  }

  let largestLostOdds = 0;
  for (const sel of selections) {
    if (!sel) continue;
    if (String(sel.result ?? "").toUpperCase() !== "LOST") continue;
    const o = Number(sel.odds);
    if (Number.isFinite(o) && o > largestLostOdds) largestLostOdds = o;
  }
  if (largestLostOdds <= 0) return cashbackFail("no_lost_leg");

  const totalOdds = placementTotalOdds(ticket, selections);
  if (!Number.isFinite(totalOdds) || totalOdds <= 0) {
    return cashbackFail("invalid_total_odds");
  }

  const result = totalOdds / largestLostOdds;
  const minResult = Number(rules.minResult ?? 0);
  if (Number.isFinite(minResult) && minResult > 0 && result < minResult) {
    return cashbackFail("below_min_result", { result });
  }

  const tier = pickCashbackTier(result, tiers);
  if (!tier) return cashbackFail("no_matching_tier", { result });

  const amount = roundMoney(stake * tier.stakeMultiplier);
  if (!(amount > 0)) return cashbackFail("non_positive_amount", { result, tier });

  return {
    eligible: true,
    amount,
    reason: "eligible",
    result,
    tier,
    profileKey: null,
  };
}

/**
 * Cashback evaluation (pure, no DB).
 *
 * v3 (`rules.profiles`): pick a profile by lost-leg count, then
 * `result = sold total odds / sum of lost-leg odds`.
 * v2 (`rules.tiers` only): `result = total_odds / largestLostLegOdds`.
 *
 * @param {Object} p
 * @param {import("@prisma/client").Ticket} p.ticket — pre-LOST total_odds, stake, created_at
 * @param {Array<{ result?: string, odds?: number, live_at_placement?: boolean }>} [p.selections]
 * @param {Array<string>} [p.fixtureStatuses] — feed statuses for the ticket's fixtures
 * @param {Array<string>} [p.matchStatuses] — admin Match statuses for the ticket's matches
 * @param {import("@prisma/client").Bonus | null} p.bonus
 * @param {Date} [p.now]
 * @param {boolean} [p.isOnline] — true for player-wallet tickets; false for cashier-printed
 * @returns {{ eligible: boolean, amount: number, reason: string, result: number | null, tier: object | null, profileKey: string | null }}
 */
export function evaluateCashback({
  ticket,
  selections = [],
  fixtureStatuses = [],
  matchStatuses = [],
  bonus,
  now = new Date(),
  isOnline = false,
}) {
  if (!bonus || bonus.type !== "CASHBACK" || !bonus.status) {
    return cashbackFail("inactive");
  }
  // user_id is required only for online wallet credit (caller-enforced).
  // Cashier-printed slips have no player and are paid at the counter.
  if (!ticket) return cashbackFail("no_ticket");

  const rules =
    bonus.rules && typeof bonus.rules === "object" ? bonus.rules : {};
  const profiles = Array.isArray(rules.profiles) ? rules.profiles : [];
  if (profiles.length > 0) {
    return evaluateCashbackProfiles({
      ticket,
      selections,
      fixtureStatuses,
      matchStatuses,
      rules,
      now,
      isOnline,
    });
  }

  return evaluateCashbackV2({
    ticket,
    selections,
    fixtureStatuses,
    matchStatuses,
    rules,
    now,
  });
}

/**
 * Cashback amount for a LOST ticket. When the bonus uses v3 profiles or
 * v2 tiers the full eligibility + tier evaluation runs and requires
 * `context` (selections, fixture/match statuses, now, isOnline). Otherwise
 * falls back to the legacy flat `% of stake` model for backward compat.
 *
 * @param {import("@prisma/client").Ticket} ticket — pre-LOST total_odds & stake
 * @param {import("@prisma/client").Bonus | null} bonus
 * @param {{ selections?: Array, fixtureStatuses?: Array<string>, matchStatuses?: Array<string>, now?: Date, isOnline?: boolean } | null} [context]
 */
export function computeCashbackAmount(ticket, bonus, context = null) {
  if (!bonus || bonus.type !== "CASHBACK" || !bonus.status) return 0;
  if (!ticket || !ticket.user_id) return 0;

  const rules =
    bonus.rules && typeof bonus.rules === "object" ? bonus.rules : {};
  const hasProfiles = Array.isArray(rules.profiles) && rules.profiles.length > 0;
  const hasTiers = Array.isArray(rules.tiers) && rules.tiers.length > 0;

  if (hasProfiles || hasTiers) {
    const ev = evaluateCashback({
      ticket,
      selections: context?.selections ?? [],
      fixtureStatuses: context?.fixtureStatuses ?? [],
      matchStatuses: context?.matchStatuses ?? [],
      bonus,
      now: context?.now ?? new Date(),
      isOnline: context?.isOnline ?? true,
    });
    return ev.eligible ? ev.amount : 0;
  }

  // Legacy flat `% of stake` when total odds meet a single minimum.
  const minOdds = Number(rules.minTotalOdds ?? 1);
  const pctStake = Number(rules.percentOfStake ?? bonus.percentage ?? 0);
  const totalOdds = Number(ticket.total_odds);
  const stake = Number(ticket.stake);
  if (!Number.isFinite(totalOdds) || totalOdds < minOdds) return 0;
  if (!Number.isFinite(pctStake) || pctStake <= 0) return 0;
  if (!Number.isFinite(stake) || stake <= 0) return 0;
  return roundMoney((stake * pctStake) / 100);
}

function isUniqueConstraintError(err) {
  return err?.code === "P2002";
}

/**
 * Idempotent credit to main wallet (v1). Bonus wallet can reuse references later.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ walletId: string, amount: number, reference: string }} p
 */
export async function creditBonusIfNew(tx, { walletId, amount, reference }) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) {
    return { credited: false, reason: "non_positive" };
  }
  const exists = await tx.transaction.findFirst({
    where: { reference },
    select: { id: true },
  });
  if (exists) return { credited: false, reason: "duplicate" };

  const w = await tx.wallet.findUnique({ where: { id: walletId } });
  if (!w) return { credited: false, reason: "no_wallet" };
  const beforeSnap = walletSnapshot(w);

  // Bonuses are not withdrawable until the player has played through.
  const credited = await creditWallet(tx, w, a, { withdrawable: false });

  try {
    await tx.transaction.create({
      data: {
        wallet_id: walletId,
        type: "BONUS",
        amount: a,
        balance_before: credited.balanceBefore,
        balance_after: credited.balanceAfter,
        reference,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      await restoreWallet(tx, w, beforeSnap);
      return { credited: false, reason: "duplicate_race" };
    }
    throw err;
  }

  return { credited: true, balanceAfter: credited.balanceAfter };
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ walletId: string, depositAmount: number, playerDepositTxId: string, hadFirstDepositAt: Date | null }} p
 */
export async function applyDepositBonusesInTx(tx, p) {
  const { walletId, depositAmount, playerDepositTxId, hadFirstDepositAt } = p;
  const isFirst = !hadFirstDepositAt;
  const [firstB, depB] = await Promise.all([
    getActiveBonus(tx, "FIRST_DEPOSIT"),
    getActiveBonus(tx, "DEPOSIT"),
  ]);
  const amount = computeStackedDepositBonusAmount(
    firstB,
    depB,
    depositAmount,
    isFirst,
  );
  if (amount <= 0) return { credited: false };

  const ref = depositBonusRef(playerDepositTxId);
  return creditBonusIfNew(tx, { walletId, amount, reference: ref });
}

/**
 * Load selection legs + fixture/match statuses used by cashback evaluation.
 * Shared by online wallet credit and cashier claim-time quote/payout.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} db
 * @param {string} ticketId
 * @returns {Promise<{ selections: Array, fixtureStatuses: string[], matchStatuses: string[] }>}
 */
export async function loadCashbackContext(db, ticketId) {
  const selections = await db.ticketSelection.findMany({
    where: { ticket_id: ticketId },
  });
  const fixtureIds = [
    ...new Set(selections.map((s) => s.fixture_id).filter(Boolean)),
  ];
  const matchIds = [
    ...new Set(selections.map((s) => s.match_id).filter(Boolean)),
  ];
  const [fixtures, matches] = await Promise.all([
    fixtureIds.length
      ? db.fixture.findMany({
          where: { id: { in: fixtureIds } },
          select: { status: true },
        })
      : Promise.resolve([]),
    matchIds.length
      ? db.match.findMany({
          where: { id: { in: matchIds } },
          select: { status: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    selections,
    fixtureStatuses: fixtures.map((f) => f.status).filter(Boolean),
    matchStatuses: matches.map((m) => m.status).filter(Boolean),
  };
}

/** Ledger reference for cashier cashback payout at the counter. */
export function cashbackPayoutRef(ticketId) {
  return `cashback-payout:${ticketId}`;
}

/**
 * Cashback for online wallet tickets only (skip cashier-printed slips).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} ticketId
 */
export async function creditCashbackOnLostTicketInTx(tx, ticketId) {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.status !== "LOST") {
    return { credited: false, reason: "not_lost" };
  }
  if (!ticket.user_id) return { credited: false, reason: "no_user" };

  const cashierPrint = await tx.transaction.findFirst({
    where: { type: "BET", reference: `ticket-print:${ticket.id}` },
    select: { id: true },
  });
  if (cashierPrint) return { credited: false, reason: "cashier_print" };

  const bonus = await getActiveBonus(tx, "CASHBACK");
  if (!bonus) return { credited: false, reason: "not_eligible" };

  // Tiered rules need the slip's selections plus the live fixture/match
  // statuses to enforce the count / disqualified-leg gates. Legacy flat
  // rules ignore this context (passed but unused).
  const { selections, fixtureStatuses, matchStatuses } =
    await loadCashbackContext(tx, ticketId);

  const amount = computeCashbackAmount(ticket, bonus, {
    selections,
    fixtureStatuses,
    matchStatuses,
    now: new Date(),
    isOnline: true,
  });
  if (amount <= 0) return { credited: false, reason: "not_eligible" };

  const wallet = await tx.wallet.findFirst({
    where: { user_id: ticket.user_id, wallet_type: "PLAYER" },
  });
  if (!wallet) return { credited: false, reason: "no_wallet" };

  return creditBonusIfNew(tx, {
    walletId: wallet.id,
    amount,
    reference: cashbackBonusRef(ticketId),
  });
}

/**
 * Public/sanitized shapes for players (no internal fields).
 */
export function sanitizeBonusForPublic(b) {
  if (!b) return null;
  return {
    type: b.type,
    name: b.name,
    percentage: b.percentage,
    min_deposit: b.min_deposit,
    rules: b.rules ?? null,
  };
}
