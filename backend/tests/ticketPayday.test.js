/**
 * Payday attribution: paid stats use paid_at, sales use created_at.
 * Run: node --test backend/tests/ticketPayday.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAgentPaydayTicket,
  applyAgentSaleTicket,
  buildSalesReportAggregates,
  emptyAgentBranchRow,
  emptyAgentCashierRow,
  paidAtFromLedger,
  payoutStatusWrite,
  ticketListDateField,
  ticketListOrderBy,
} from "../lib/ticketPayday.js";

function getDayLabel(date) {
  return date.toISOString().slice(0, 10);
}

test("list date field uses paid_at only for PAID and CASHBACK_PAID", () => {
  assert.equal(ticketListDateField("PAID"), "paid_at");
  assert.equal(ticketListDateField("CASHBACK_PAID"), "paid_at");
  assert.equal(ticketListDateField("WON"), "created_at");
  assert.equal(ticketListDateField("PRINTED"), "created_at");
  assert.equal(ticketListDateField(""), "created_at");
  assert.deepEqual(ticketListOrderBy("PAID"), { paid_at: "desc" });
  assert.deepEqual(ticketListOrderBy("OPEN"), { created_at: "desc" });
});

test("payoutStatusWrite stamps paid_at with status", () => {
  const at = new Date("2026-08-23T12:00:00.000Z");
  assert.deepEqual(payoutStatusWrite("PAID", at), {
    status: "PAID",
    paid_at: at,
  });
});

test("sales report: stake on print day, paid on payday", () => {
  const start = new Date("2026-08-21T00:00:00.000Z");
  const sold = [
    {
      cashier_id: "c1",
      branch_name: "Addis",
      stake: 100,
      status: "PAID",
      created_at: new Date("2026-08-21T10:00:00.000Z"),
    },
  ];
  const paid = [
    {
      cashier_id: "c1",
      branch_name: "Addis",
      status: "PAID",
      paid_at: new Date("2026-08-22T15:00:00.000Z"),
    },
  ];

  const result = buildSalesReportAggregates({
    soldTickets: sold,
    paidTickets: paid,
    start,
    daySpan: 2,
    getDayLabel,
    cashierNameById: new Map([["c1", "Abebe"]]),
  });

  const day1 = result.dailyMap.get("2026-08-21");
  const day2 = result.dailyMap.get("2026-08-22");
  assert.equal(day1.tickets, 1);
  assert.equal(day1.stake, 100);
  assert.equal(day1.paid, 0);
  assert.equal(day2.tickets, 0);
  assert.equal(day2.stake, 0);
  assert.equal(day2.paid, 1);
  assert.equal(result.paidTicketsCount, 1);
  assert.equal(result.totalStake, 100);

  const branch = result.branchMap.get("Addis");
  assert.equal(branch.tickets, 1);
  assert.equal(branch.stake, 100);
  assert.equal(branch.paid, 1);

  const cashier = result.cashierMap.get("c1");
  assert.equal(cashier.tickets, 1);
  assert.equal(cashier.paid, 1);
  assert.equal(cashier.cashierName, "Abebe");
});

test("sales report: payday-only ticket still counts paid without moving stake", () => {
  const start = new Date("2026-08-23T00:00:00.000Z");
  const result = buildSalesReportAggregates({
    soldTickets: [],
    paidTickets: [
      {
        cashier_id: "c2",
        branch_name: "Bole",
        status: "PAID",
        paid_at: new Date("2026-08-23T09:00:00.000Z"),
      },
      {
        cashier_id: "c2",
        branch_name: "Bole",
        status: "CASHBACK_PAID",
        paid_at: new Date("2026-08-23T11:00:00.000Z"),
      },
    ],
    start,
    daySpan: 1,
    getDayLabel,
    cashierNameById: new Map(),
  });

  const day = result.dailyMap.get("2026-08-23");
  assert.equal(day.tickets, 0);
  assert.equal(day.paid, 1);
  assert.equal(day.cashbackPaid, 1);
  assert.equal(result.paidTicketsCount, 1);
  assert.equal(result.cashbackPaidTicketsCount, 1);
  assert.equal(result.branchMap.get("Bole").paid, 1);
  assert.equal(result.branchMap.get("Bole").cashbackPaid, 1);
});

test("agent rows: sold increments stake, payday increments paid only", () => {
  const branch = emptyAgentBranchRow("Kirkos");
  const cashier = emptyAgentCashierRow("c1", "Cashier");
  applyAgentSaleTicket(
    { stake: 50, status: "PAID", branch_name: "Kirkos", cashier_id: "c1" },
    branch,
    cashier,
  );
  applyAgentPaydayTicket({ status: "PAID" }, branch, cashier);
  assert.equal(branch.tickets, 1);
  assert.equal(branch.stake, 50);
  assert.equal(branch.paid, 1);
  assert.equal(cashier.paid, 1);
});

test("paidAtFromLedger prefers cashier ticket: then win-settlement", () => {
  const txs = [
    {
      reference: "win-settlement:tk-1",
      created_at: new Date("2026-08-20T00:00:00.000Z"),
    },
    {
      reference: "ticket:tk-1",
      created_at: new Date("2026-08-22T00:00:00.000Z"),
    },
  ];
  assert.equal(
    paidAtFromLedger("tk-1", "PAID", txs).toISOString(),
    "2026-08-22T00:00:00.000Z",
  );
  assert.equal(
    paidAtFromLedger("tk-1", "CASHBACK_PAID", [
      {
        reference: "cashback-payout:tk-1",
        created_at: new Date("2026-08-21T00:00:00.000Z"),
      },
    ]).toISOString(),
    "2026-08-21T00:00:00.000Z",
  );
  assert.equal(paidAtFromLedger("tk-missing", "PAID", txs), null);
});
