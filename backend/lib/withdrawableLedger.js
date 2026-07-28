/**
 * Classify ledger rows and replay PLAYER withdrawable accounting.
 *
 * Withdrawable credits (increase both balance + withdrawable):
 *   - PAYOUT  mrx:win:*            (MRX Instant Games wins)
 *   - PAYOUT  inout:withdraw:*     (InOut casino wins)
 *   - PAYOUT  win-settlement:*     (sportsbook online wins)
 *   - CASHOUT cashout:*            (sportsbook cashout)
 *   - other PAYOUT on player wallets (default win/payout)
 *
 * Non-withdrawable credits (balance only):
 *   - DEPOSIT / BONUS
 *   - PAYOUT  inout:rollback:*     (casino stake refund)
 *   - DEPOSIT bet-refund:* / cancel-refund:* / void-refund:* etc.
 *
 * Debits:
 *   - BET      — stake: burn non-withdrawable first, then withdrawable
 *   - WITHDRAW — from withdrawable (skip still-pending rows)
 *
 * @module lib/withdrawableLedger
 */

import { toMoney, d } from "./moneyDecimal.js";

/**
 * Whether a credit ledger row should increase `withdrawable`.
 * @param {string} type
 * @param {string|null|undefined} reference
 */
export function isWithdrawableLedgerCredit(type, reference) {
  const t = String(type ?? "");
  const ref = String(reference ?? "");

  if (t === "CASHOUT") return true;

  if (t === "PAYOUT") {
    // Stake refunds must not unlock deposits.
    if (ref.startsWith("inout:rollback:")) return false;
    // Explicit game / sportsbook win refs (and any other player PAYOUT).
    return true;
  }

  return false;
}

/**
 * True when a WITHDRAW row has not yet moved wallet funds
 * (shop/admin pending still shows balance_before === balance_after).
 * @param {{ type: string, reference?: string|null, balance_before?: number, balance_after?: number }} tx
 */
export function isPendingWithdrawLedger(tx) {
  if (String(tx?.type) !== "WITHDRAW") return false;
  const ref = String(tx?.reference ?? "");
  if (!ref.startsWith("pending:")) return false;
  const before = toMoney(tx.balance_before ?? 0);
  const after = toMoney(tx.balance_after ?? 0);
  return before === after;
}

/**
 * Replay ledger rows (oldest → newest) into balance + withdrawable.
 *
 * @param {Array<{ type: string, amount: number, reference?: string|null, balance_before?: number, balance_after?: number }>} transactions
 * @returns {{ balance: number, withdrawable: number }}
 */
export function replayWithdrawableLedger(transactions) {
  let balance = 0;
  let withdrawable = 0;

  for (const tx of transactions ?? []) {
    const type = String(tx.type ?? "");
    const amount = toMoney(tx.amount ?? 0);
    if (!Number.isFinite(amount) || amount < 0) continue;

    if (type === "DEPOSIT" || type === "BONUS") {
      balance = toMoney(d(balance).add(amount));
      continue;
    }

    if (type === "PAYOUT" || type === "CASHOUT") {
      balance = toMoney(d(balance).add(amount));
      if (amount > 0 && isWithdrawableLedgerCredit(type, tx.reference)) {
        withdrawable = toMoney(d(withdrawable).add(amount));
      }
      if (withdrawable > balance) withdrawable = balance;
      continue;
    }

    if (type === "BET") {
      if (amount <= 0) continue;
      if (balance < amount) {
        // Ledger inconsistency — clamp to available.
        const take = balance;
        const nonWithdrawable = toMoney(d(balance).sub(withdrawable));
        const fromNon = Math.min(take, Math.max(0, nonWithdrawable));
        const fromWith = toMoney(d(take).sub(fromNon));
        withdrawable = toMoney(d(withdrawable).sub(fromWith));
        balance = 0;
        continue;
      }
      const nonWithdrawable = toMoney(d(balance).sub(withdrawable));
      const fromNon = Math.min(amount, Math.max(0, nonWithdrawable));
      const fromWith = toMoney(d(amount).sub(fromNon));
      withdrawable = toMoney(d(withdrawable).sub(fromWith));
      balance = toMoney(d(balance).sub(amount));
      continue;
    }

    if (type === "WITHDRAW") {
      if (isPendingWithdrawLedger(tx)) continue;
      if (amount <= 0) continue;
      const take = Math.min(amount, balance);
      const fromWith = Math.min(take, withdrawable);
      withdrawable = toMoney(d(withdrawable).sub(fromWith));
      balance = toMoney(d(balance).sub(take));
    }
  }

  if (withdrawable < 0) withdrawable = 0;
  if (withdrawable > balance) withdrawable = balance;
  return { balance: toMoney(balance), withdrawable: toMoney(withdrawable) };
}
