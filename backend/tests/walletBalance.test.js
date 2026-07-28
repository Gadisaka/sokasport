/**
 * Unit tests for withdrawable balance accounting.
 *
 * Run with: node --test backend/tests/walletBalance.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  creditWallet,
  debitWallet,
  restoreWallet,
  walletSnapshot,
} from "../lib/walletBalance.js";

function createMockTx(wallet) {
  const store = new Map([[wallet.id, { ...wallet }]]);
  return {
    store,
    wallet: {
      update: async ({ where, data }) => {
        const current = store.get(where.id);
        for (const [key, value] of Object.entries(data)) {
          if (
            value &&
            typeof value === "object" &&
            Object.prototype.hasOwnProperty.call(value, "increment")
          ) {
            current[key] = Number(current[key] ?? 0) + Number(value.increment);
          } else {
            current[key] = value;
          }
        }
        return { ...current };
      },
      findUnique: async ({ where }) => {
        const current = store.get(where.id);
        return current ? { ...current } : null;
      },
    },
  };
}

test("deposit credit does not increase withdrawable", async () => {
  const wallet = {
    id: "pw1",
    wallet_type: "PLAYER",
    balance: 0,
    withdrawable: 0,
  };
  const tx = createMockTx(wallet);
  const result = await creditWallet(tx, wallet, 200, { withdrawable: false });
  assert.equal(result.balanceAfter, 200);
  assert.equal(result.withdrawableAfter, 0);
  assert.equal(tx.store.get("pw1").balance, 200);
  assert.equal(tx.store.get("pw1").withdrawable, 0);
});

test("payout credit increases withdrawable", async () => {
  const wallet = {
    id: "pw1",
    wallet_type: "PLAYER",
    balance: 150,
    withdrawable: 0,
  };
  const tx = createMockTx(wallet);
  // Simulate live wallet state after deposit+partial bet already applied
  const live = tx.store.get("pw1");
  const result = await creditWallet(tx, live, 100, { withdrawable: true });
  assert.equal(result.balanceAfter, 250);
  assert.equal(result.withdrawableAfter, 100);
});

test("stake consumes non-withdrawable first", async () => {
  // balance 300, withdrawable 100 → non-withdrawable 200
  // stake 50 → withdrawable stays 100
  const wallet = {
    id: "pw1",
    wallet_type: "PLAYER",
    balance: 300,
    withdrawable: 100,
  };
  const tx = createMockTx(wallet);
  const live = tx.store.get("pw1");
  const result = await debitWallet(tx, live, 50, { fromWithdrawable: false });
  assert.equal(result.balanceAfter, 250);
  assert.equal(result.withdrawableAfter, 100);
});

test("stake that exceeds non-withdrawable also reduces withdrawable", async () => {
  // balance 300, withdrawable 100 → non-withdrawable 200
  // stake 250 → consumes 200 non + 50 withdrawable → withdrawable 50
  const wallet = {
    id: "pw1",
    wallet_type: "PLAYER",
    balance: 300,
    withdrawable: 100,
  };
  const tx = createMockTx(wallet);
  const live = tx.store.get("pw1");
  const result = await debitWallet(tx, live, 250, { fromWithdrawable: false });
  assert.equal(result.balanceAfter, 50);
  assert.equal(result.withdrawableAfter, 50);
});

test("withdraw requires sufficient withdrawable", async () => {
  const wallet = {
    id: "pw1",
    wallet_type: "PLAYER",
    balance: 300,
    withdrawable: 100,
  };
  const tx = createMockTx(wallet);
  const live = tx.store.get("pw1");
  await assert.rejects(
    () => debitWallet(tx, live, 150, { fromWithdrawable: true }),
    (err) => err.message === "INSUFFICIENT_WITHDRAWABLE",
  );
  // unchanged after failed debit
  assert.equal(tx.store.get("pw1").balance, 300);
  assert.equal(tx.store.get("pw1").withdrawable, 100);

  const ok = await debitWallet(tx, live, 80, { fromWithdrawable: true });
  assert.equal(ok.balanceAfter, 220);
  assert.equal(ok.withdrawableAfter, 20);
});

test("cancel-style refund does not increase withdrawable", async () => {
  const wallet = {
    id: "pw1",
    wallet_type: "PLAYER",
    balance: 100,
    withdrawable: 40,
  };
  const tx = createMockTx(wallet);
  const live = tx.store.get("pw1");
  const result = await creditWallet(tx, live, 50, { withdrawable: false });
  assert.equal(result.balanceAfter, 150);
  assert.equal(result.withdrawableAfter, 40);
});

test("restoreWallet reverts both fields", async () => {
  const wallet = {
    id: "pw1",
    wallet_type: "PLAYER",
    balance: 100,
    withdrawable: 25,
  };
  const tx = createMockTx(wallet);
  const live = tx.store.get("pw1");
  const snap = walletSnapshot(live);
  await creditWallet(tx, live, 50, { withdrawable: true });
  assert.equal(tx.store.get("pw1").balance, 150);
  assert.equal(tx.store.get("pw1").withdrawable, 75);
  await restoreWallet(tx, live, snap);
  assert.equal(tx.store.get("pw1").balance, 100);
  assert.equal(tx.store.get("pw1").withdrawable, 25);
});

test("cashier wallet credit ignores withdrawable flag", async () => {
  const wallet = {
    id: "cw1",
    wallet_type: "CASHIER",
    balance: 500,
    withdrawable: 0,
  };
  const tx = createMockTx(wallet);
  const live = tx.store.get("cw1");
  const result = await creditWallet(tx, live, 100, { withdrawable: true });
  assert.equal(result.balanceAfter, 600);
  assert.equal(result.withdrawableAfter, 0);
  assert.equal(tx.store.get("cw1").balance, 600);
  assert.equal(tx.store.get("cw1").withdrawable, 0);
});

test("example scenario: deposit 200, bet 50, win payout 150 → balance 300 withdrawable 150", async () => {
  const wallet = {
    id: "pw1",
    wallet_type: "PLAYER",
    balance: 0,
    withdrawable: 0,
  };
  const tx = createMockTx(wallet);
  let live = tx.store.get("pw1");

  await creditWallet(tx, live, 200, { withdrawable: false });
  live = tx.store.get("pw1");
  assert.deepEqual(
    { balance: live.balance, withdrawable: live.withdrawable },
    { balance: 200, withdrawable: 0 },
  );

  await debitWallet(tx, live, 50, { fromWithdrawable: false });
  live = tx.store.get("pw1");
  assert.deepEqual(
    { balance: live.balance, withdrawable: live.withdrawable },
    { balance: 150, withdrawable: 0 },
  );

  // Full settlement credit (stake return + profit) is withdrawable
  await creditWallet(tx, live, 150, { withdrawable: true });
  live = tx.store.get("pw1");
  assert.deepEqual(
    { balance: live.balance, withdrawable: live.withdrawable },
    { balance: 300, withdrawable: 150 },
  );
});
