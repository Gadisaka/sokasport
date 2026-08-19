/**
 * Unit tests for cashier print-hold ledger.
 *
 * Run with: node --test backend/tests/cashierPrintHold.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abortCashierPrintHoldInTx,
  cashierPrintBetReference,
  findCashierPrintBet,
  holdCashierPrintInTx,
} from "../services/cashierPrintHold.js";
import { refundTicketStakeInTx } from "../services/ticketCancelRefund.js";

function createMockTx(initial) {
  const wallets = new Map(initial.wallets.map((w) => [w.id, { ...w }]));
  const transactions = [...initial.transactions];
  const tickets = new Map((initial.tickets || []).map((t) => [t.id, { ...t }]));
  let receiptSeq = 0;

  const findTx = (where) => {
    return (
      transactions.find((row) => {
        if (where.type && row.type !== where.type) return false;
        if (where.wallet_id && row.wallet_id !== where.wallet_id) return false;
        if (where.reference) {
          if (typeof where.reference === "object" && "in" in where.reference) {
            if (!where.reference.in.includes(row.reference)) return false;
          } else if (row.reference !== where.reference) {
            return false;
          }
        }
        return true;
      }) ?? null
    );
  };

  return {
    wallets,
    transactions,
    tickets,
    transaction: {
      findFirst: async ({ where }) => {
        const row = findTx(where);
        return row ? { ...row } : null;
      },
      create: async ({ data }) => {
        const dup = transactions.some((t) => t.reference === data.reference);
        if (dup) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        const row = { id: `tx-${transactions.length + 1}`, ...data };
        transactions.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = transactions.find((t) => t.id === where.id);
        if (!row) throw new Error("TRANSACTION_NOT_FOUND");
        Object.assign(row, data);
        return { ...row };
      },
    },
    wallet: {
      findUnique: async ({ where }) => {
        const wallet = wallets.get(where.id);
        return wallet ? { ...wallet } : null;
      },
      update: async ({ where, data }) => {
        const wallet = wallets.get(where.id);
        Object.assign(wallet, data);
        return { ...wallet };
      },
    },
    ticket: {
      findUnique: async ({ where }) => {
        const ticket = tickets.get(where.id);
        return ticket ? { ...ticket } : null;
      },
      update: async ({ where, data }) => {
        const ticket = tickets.get(where.id);
        Object.assign(ticket, data);
        return { ...ticket };
      },
    },
    nextReceipt: () => {
      receiptSeq += 1;
      return `11111-${String(receiptSeq).padStart(5, "0")}`;
    },
  };
}

const cashier = {
  id: "cashier-1",
  wallet_id: "cw1",
  branch_name: "Butajira",
  branch_location: "Oromiya",
};

function holdArgs(tx, ticket) {
  return {
    ticket,
    cashier,
    reserveReceiptNumber: async () => tx.nextReceipt(),
  };
}

test("hold with 0 balance throws insufficient and writes no BET or receipt", async () => {
  const ticket = {
    id: "tk-1",
    stake: 20,
    status: "OPEN",
    cashier_id: null,
    receipt_number: null,
    branch_name: "",
    branch_location: "",
  };
  const tx = createMockTx({
    wallets: [{ id: "cw1", user_id: "u1", wallet_type: "CASHIER", balance: 0 }],
    transactions: [],
    tickets: [ticket],
  });

  await assert.rejects(
    () => holdCashierPrintInTx(tx, holdArgs(tx, ticket)),
    (err) => err.message === "INSUFFICIENT_BALANCE",
  );
  assert.equal(tx.transactions.length, 0);
  assert.equal(tx.tickets.get("tk-1").receipt_number, null);
  assert.equal(tx.wallets.get("cw1").balance, 0);
});

test("hold with enough balance inserts ticket-print BET and assigns receipt", async () => {
  const ticket = {
    id: "tk-2",
    stake: 20,
    status: "OPEN",
    cashier_id: null,
    receipt_number: null,
    branch_name: "",
    branch_location: "",
  };
  const tx = createMockTx({
    wallets: [{ id: "cw1", user_id: "u1", wallet_type: "CASHIER", balance: 100 }],
    transactions: [],
    tickets: [ticket],
  });

  const result = await holdCashierPrintInTx(tx, holdArgs(tx, ticket));

  assert.equal(result.alreadyHeld, false);
  assert.equal(result.deductedAmount, 20);
  assert.equal(result.balanceAfter, 80);
  assert.equal(tx.wallets.get("cw1").balance, 80);
  assert.equal(tx.tickets.get("tk-2").receipt_number, "11111-00001");
  assert.equal(tx.tickets.get("tk-2").cashier_id, "cashier-1");
  const bet = tx.transactions.find(
    (t) => t.reference === cashierPrintBetReference("tk-2"),
  );
  assert.equal(bet?.type, "BET");
  assert.equal(bet?.amount, 20);
  assert.equal(bet?.balance_before, 100);
  assert.equal(bet?.balance_after, 80);
});

test("second hold is idempotent and does not debit again", async () => {
  const ticket = {
    id: "tk-3",
    stake: 25,
    status: "OPEN",
    cashier_id: "cashier-1",
    receipt_number: "22222-00001",
    branch_name: "Butajira",
    branch_location: "Oromiya",
  };
  const tx = createMockTx({
    wallets: [{ id: "cw1", user_id: "u1", wallet_type: "CASHIER", balance: 75 }],
    transactions: [
      {
        id: "bet1",
        type: "BET",
        wallet_id: "cw1",
        amount: 25,
        reference: cashierPrintBetReference("tk-3"),
      },
    ],
    tickets: [ticket],
  });

  const result = await holdCashierPrintInTx(tx, holdArgs(tx, ticket));

  assert.equal(result.alreadyHeld, true);
  assert.equal(result.deductedAmount, 0);
  assert.equal(tx.wallets.get("cw1").balance, 75);
  assert.equal(tx.transactions.length, 1);
});

test("abort renames BET, credits shop, and a new hold can debit again", async () => {
  const ticket = {
    id: "tk-4",
    stake: 20,
    status: "OPEN",
    cashier_id: "cashier-1",
    receipt_number: "33333-00001",
    branch_name: "Butajira",
    branch_location: "Oromiya",
  };
  const tx = createMockTx({
    wallets: [{ id: "cw1", user_id: "u1", wallet_type: "CASHIER", balance: 80 }],
    transactions: [
      {
        id: "bet1",
        type: "BET",
        wallet_id: "cw1",
        amount: 20,
        reference: cashierPrintBetReference("tk-4"),
      },
    ],
    tickets: [ticket],
  });

  const aborted = await abortCashierPrintHoldInTx(tx, {
    ticketId: "tk-4",
    now: 1700000000000,
  });

  assert.equal(aborted.aborted, true);
  assert.equal(aborted.refunded, 20);
  assert.equal(tx.wallets.get("cw1").balance, 100);
  assert.equal(await findCashierPrintBet(tx, "tk-4"), null);
  assert.equal(
    tx.transactions.some((t) => t.reference === "print-aborted:tk-4:1700000000000"),
    true,
  );
  assert.equal(
    tx.transactions.some((t) => t.reference === "print-abort-refund:tk-4:1700000000000"),
    true,
  );
  assert.equal(
    tx.transactions.some((t) => String(t.reference).startsWith("ticket-print:")),
    false,
  );

  const liveTicket = tx.tickets.get("tk-4");
  const heldAgain = await holdCashierPrintInTx(tx, holdArgs(tx, liveTicket));
  assert.equal(heldAgain.alreadyHeld, false);
  assert.equal(heldAgain.deductedAmount, 20);
  assert.equal(tx.wallets.get("cw1").balance, 80);
  assert.ok(await findCashierPrintBet(tx, "tk-4"));
});

test("abort is idempotent when no live print BET exists", async () => {
  const tx = createMockTx({
    wallets: [{ id: "cw1", user_id: "u1", wallet_type: "CASHIER", balance: 50 }],
    transactions: [],
    tickets: [{ id: "tk-5", stake: 20, status: "OPEN" }],
  });

  const result = await abortCashierPrintHoldInTx(tx, { ticketId: "tk-5" });
  assert.equal(result.aborted, false);
  assert.equal(result.reason, "not_held");
  assert.equal(tx.wallets.get("cw1").balance, 50);
});

test("cancel after abort does not extra-credit cashier wallet", async () => {
  const ticket = {
    id: "tk-6",
    stake: 30,
    status: "OPEN",
    coupon_number: "12345-67890",
  };
  const tx = createMockTx({
    wallets: [{ id: "cw1", user_id: "u1", wallet_type: "CASHIER", balance: 70 }],
    transactions: [
      {
        id: "bet1",
        type: "BET",
        wallet_id: "cw1",
        amount: 30,
        reference: cashierPrintBetReference("tk-6"),
      },
    ],
    tickets: [ticket],
  });

  await abortCashierPrintHoldInTx(tx, { ticketId: "tk-6", now: 99 });
  assert.equal(tx.wallets.get("cw1").balance, 100);

  const refunds = await refundTicketStakeInTx(tx, ticket);
  assert.equal(refunds.length, 0);
  assert.equal(tx.wallets.get("cw1").balance, 100);
  assert.equal(
    tx.transactions.some((t) => t.reference === "cancel-refund:tk-6"),
    false,
  );
});
