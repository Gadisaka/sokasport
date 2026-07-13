/**
 * Unit tests for ticket cancel refunds.
 *
 * Run with: node --test backend/tests/ticketCancelRefund.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refundTicketStakeInTx } from "../services/ticketCancelRefund.js";

function createMockTx(initial) {
  const wallets = new Map(initial.wallets.map((w) => [w.id, { ...w }]));
  const transactions = [...initial.transactions];

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
    transaction: {
      findFirst: async ({ where }) => findTx(where),
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
    },
    wallet: {
      findFirst: async ({ where }) => {
        for (const wallet of wallets.values()) {
          if (where.user_id && wallet.user_id !== where.user_id) continue;
          if (where.wallet_type && wallet.wallet_type !== where.wallet_type) {
            continue;
          }
          return { ...wallet };
        }
        return null;
      },
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
  };
}

test("refundTicketStakeInTx credits cashier wallet for ticket-print BET", async () => {
  const tx = createMockTx({
    wallets: [{ id: "cw1", user_id: "cashier-user", wallet_type: "CASHIER", balance: 100 }],
    transactions: [
      {
        id: "bet1",
        type: "BET",
        wallet_id: "cw1",
        amount: 20,
        reference: "ticket-print:tk-1",
      },
    ],
  });

  const refunds = await refundTicketStakeInTx(tx, {
    id: "tk-1",
    stake: 20,
    coupon_number: "12345-67890",
  });

  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].kind, "cashier");
  assert.equal(refunds[0].amount, 20);
  assert.equal(tx.wallets.get("cw1").balance, 120);
  assert.equal(
    tx.transactions.some((t) => t.reference === "cancel-refund:tk-1"),
    true,
  );
});

test("refundTicketStakeInTx credits player wallet for online BET", async () => {
  const tx = createMockTx({
    wallets: [
      {
        id: "pw1",
        user_id: "player-1",
        wallet_type: "PLAYER",
        balance: 50,
        withdrawable: 10,
      },
    ],
    transactions: [
      {
        id: "bet1",
        type: "BET",
        wallet_id: "pw1",
        amount: 15,
        reference: "ticket:11111-22222",
      },
    ],
  });

  const refunds = await refundTicketStakeInTx(tx, {
    id: "tk-2",
    user_id: "player-1",
    receipt_number: "11111-22222",
    coupon_number: "33333-44444",
    stake: 15,
  });

  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].kind, "player");
  assert.equal(tx.wallets.get("pw1").balance, 65);
  // Refund must not become withdrawable
  assert.equal(tx.wallets.get("pw1").withdrawable, 10);
});

test("refundTicketStakeInTx refunds both player and cashier when both debited", async () => {
  const tx = createMockTx({
    wallets: [
      { id: "pw1", user_id: "player-1", wallet_type: "PLAYER", balance: 30 },
      { id: "cw1", user_id: "cashier-user", wallet_type: "CASHIER", balance: 200 },
    ],
    transactions: [
      {
        id: "bet-player",
        type: "BET",
        wallet_id: "pw1",
        amount: 10,
        reference: "ticket:55555-66666",
      },
      {
        id: "bet-cashier",
        type: "BET",
        wallet_id: "cw1",
        amount: 10,
        reference: "ticket-print:tk-3",
      },
    ],
  });

  const refunds = await refundTicketStakeInTx(tx, {
    id: "tk-3",
    user_id: "player-1",
    receipt_number: "55555-66666",
    coupon_number: "77777-88888",
    stake: 10,
  });

  assert.equal(refunds.length, 2);
  assert.equal(tx.wallets.get("pw1").balance, 40);
  assert.equal(tx.wallets.get("cw1").balance, 210);
});

test("refundTicketStakeInTx is idempotent when refund refs already exist", async () => {
  const tx = createMockTx({
    wallets: [{ id: "cw1", user_id: "cashier-user", wallet_type: "CASHIER", balance: 80 }],
    transactions: [
      {
        id: "bet1",
        type: "BET",
        wallet_id: "cw1",
        amount: 20,
        reference: "ticket-print:tk-4",
      },
      {
        id: "ref1",
        type: "DEPOSIT",
        wallet_id: "cw1",
        amount: 20,
        reference: "cancel-refund:tk-4",
      },
    ],
  });

  const refunds = await refundTicketStakeInTx(tx, {
    id: "tk-4",
    stake: 20,
    coupon_number: "00000-11111",
  });

  assert.equal(refunds.length, 0);
  assert.equal(tx.wallets.get("cw1").balance, 80);
  assert.equal(tx.transactions.length, 2);
});

test("refundTicketStakeInTx returns empty when no BET transactions found", async () => {
  const tx = createMockTx({
    wallets: [{ id: "cw1", user_id: "cashier-user", wallet_type: "CASHIER", balance: 100 }],
    transactions: [],
  });

  const refunds = await refundTicketStakeInTx(tx, {
    id: "tk-5",
    stake: 25,
    coupon_number: "99999-00000",
  });

  assert.deepEqual(refunds, []);
  assert.equal(tx.wallets.get("cw1").balance, 100);
});

/**
 * Documents cancelTicket wiring (PATCH /api/tickets/:id/cancel): the controller
 * must call refundTicketStakeInTx inside the cancel transaction before setting
 * status to CANCELED — same order simulated here.
 */
test("cancel transaction sequence refunds stake before marking canceled", async () => {
  const tx = createMockTx({
    wallets: [{ id: "cw1", user_id: "cashier-user", wallet_type: "CASHIER", balance: 70 }],
    transactions: [
      {
        id: "bet1",
        type: "BET",
        wallet_id: "cw1",
        amount: 30,
        reference: "ticket-print:tk-6",
      },
    ],
  });
  const ticket = { id: "tk-6", stake: 30, coupon_number: "11111-22222" };
  let status = "PRINTED";
  const order = [];

  const refunds = await refundTicketStakeInTx(tx, ticket);
  order.push("refunded");
  status = "CANCELED";
  order.push("canceled");

  assert.deepEqual(order, ["refunded", "canceled"]);
  assert.equal(status, "CANCELED");
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].kind, "cashier");
  assert.equal(tx.wallets.get("cw1").balance, 100);
});
