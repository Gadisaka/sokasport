/**
 * Unit tests for cashier dashboard sold / grand-net totals.
 *
 * Run with: node --test backend/tests/cashierDashboardTotals.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

/** Mirrors active-sold + grandNet logic in cashierDashboardController. */
function computeDashboardTotals({
  soldBets,
  cancelledIds,
  totalPaidAmount = 0,
  totalDepositAmount = 0,
  totalWithdrawAmount = 0,
}) {
  const cancelledIdSet = new Set(cancelledIds);
  const activeSoldBets = soldBets.filter(
    (row) => row.ticketId && !cancelledIdSet.has(row.ticketId),
  );
  const totalTicketsSold = activeSoldBets.length;
  const totalSoldPrice = activeSoldBets.reduce((s, row) => s + row.amount, 0);
  const grandNet =
    totalSoldPrice -
    totalPaidAmount +
    totalDepositAmount -
    totalWithdrawAmount;
  return { totalTicketsSold, totalSoldPrice, grandNet };
}

test("excludes cancelled tickets from sold totals and grand net", () => {
  const soldBets = [
    { ticketId: "t1", amount: 20 },
    { ticketId: "t2", amount: 20 },
    { ticketId: "t3", amount: 20 },
    { ticketId: "t4", amount: 100 },
  ];

  const result = computeDashboardTotals({
    soldBets,
    cancelledIds: ["t4"],
  });

  assert.equal(result.totalTicketsSold, 3);
  assert.equal(result.totalSoldPrice, 60);
  assert.equal(result.grandNet, 60);
});

test("grand net adds deposits and subtracts payouts/withdrawals from active sold", () => {
  const result = computeDashboardTotals({
    soldBets: [
      { ticketId: "t1", amount: 60 },
      { ticketId: "t2", amount: 60 },
    ],
    cancelledIds: [],
    totalPaidAmount: 20,
    totalDepositAmount: 10,
    totalWithdrawAmount: 5,
  });

  assert.equal(result.totalSoldPrice, 120);
  assert.equal(result.grandNet, 105);
});
