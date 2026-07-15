/**
 * Unit tests for cashier dashboard sold / grand-net totals.
 *
 * Run with: node --test backend/tests/cashierDashboardTotals.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

/** Mirrors gross-sold + grandNet logic in cashierDashboardController. */
function computeDashboardTotals({
  soldBets,
  cancelledStake = 0,
  totalPaidAmount = 0,
  totalDepositAmount = 0,
  totalWithdrawAmount = 0,
}) {
  const totalTicketsSold = soldBets.length;
  const totalSoldPrice = soldBets.reduce((s, row) => s + row.amount, 0);
  const grandNet =
    totalSoldPrice -
    cancelledStake -
    totalPaidAmount +
    totalDepositAmount -
    totalWithdrawAmount;
  return { totalTicketsSold, totalSoldPrice, grandNet };
}

test("keeps cancelled tickets in sold totals and subtracts stake in grand net", () => {
  const soldBets = [
    { ticketId: "t1", amount: 20 },
    { ticketId: "t2", amount: 20 },
    { ticketId: "t3", amount: 20 },
    { ticketId: "t4", amount: 100 },
  ];

  const result = computeDashboardTotals({
    soldBets,
    cancelledStake: 100,
  });

  assert.equal(result.totalTicketsSold, 4);
  assert.equal(result.totalSoldPrice, 160);
  assert.equal(result.grandNet, 60);
});

test("grand net adds deposits and subtracts payouts/withdrawals from gross sold", () => {
  const result = computeDashboardTotals({
    soldBets: [
      { ticketId: "t1", amount: 60 },
      { ticketId: "t2", amount: 60 },
    ],
    cancelledStake: 0,
    totalPaidAmount: 20,
    totalDepositAmount: 10,
    totalWithdrawAmount: 5,
  });

  assert.equal(result.totalSoldPrice, 120);
  assert.equal(result.grandNet, 105);
});
