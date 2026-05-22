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
 * @param {import("@prisma/client").Ticket} ticket — should still reflect pre-LOST total_odds & stake
 * @param {import("@prisma/client").Bonus | null} bonus
 */
export function computeCashbackAmount(ticket, bonus) {
  if (!bonus || bonus.type !== "CASHBACK" || !bonus.status) return 0;
  if (!ticket.user_id) return 0;
  const rules =
    bonus.rules && typeof bonus.rules === "object" ? bonus.rules : {};
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
  const before = Number(w.balance) || 0;
  const after = toMoney(d(before).add(a));

  await tx.wallet.update({
    where: { id: walletId },
    data: { balance: after },
  });

  try {
    await tx.transaction.create({
      data: {
        wallet_id: walletId,
        type: "BONUS",
        amount: a,
        balance_before: before,
        balance_after: after,
        reference,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      await tx.wallet.update({
        where: { id: walletId },
        data: { balance: before },
      });
      return { credited: false, reason: "duplicate_race" };
    }
    throw err;
  }

  return { credited: true, balanceAfter: after };
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
  const amount = computeCashbackAmount(ticket, bonus);
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
