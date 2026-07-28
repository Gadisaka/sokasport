/**
 * Unit tests: withdrawable ledger classification + MRX/InOut win scenarios.
 * Run: node --test backend/tests/withdrawableLedger.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isWithdrawableLedgerCredit,
  isPendingWithdrawLedger,
  replayWithdrawableLedger,
} from "../lib/withdrawableLedger.js";
import {
  creditWallet,
  debitWallet,
} from "../lib/walletBalance.js";

function createMockTx(wallet) {
  const store = new Map([[wallet.id, { ...wallet }]]);
  return {
    store,
    wallet: {
      update: async ({ where, data }) => {
        const current = store.get(where.id);
        Object.assign(current, data);
        return { ...current };
      },
    },
  };
}

test("MRX win refs are withdrawable credits", () => {
  assert.equal(isWithdrawableLedgerCredit("PAYOUT", "mrx:win:abc"), true);
});

test("InOut withdraw (win) refs are withdrawable credits", () => {
  assert.equal(
    isWithdrawableLedgerCredit("PAYOUT", "inout:withdraw:tx-1"),
    true,
  );
});

test("InOut rollback refs are NOT withdrawable", () => {
  assert.equal(
    isWithdrawableLedgerCredit("PAYOUT", "inout:rollback:tx-1"),
    false,
  );
});

test("sportsbook settlement + cashout are withdrawable", () => {
  assert.equal(
    isWithdrawableLedgerCredit("PAYOUT", "win-settlement:t1"),
    true,
  );
  assert.equal(isWithdrawableLedgerCredit("CASHOUT", "cashout:t1"), true);
});

test("pending shop withdraw ledger rows are skipped", () => {
  assert.equal(
    isPendingWithdrawLedger({
      type: "WITHDRAW",
      reference: "pending:shop-withdraw:uuid",
      balance_before: 100,
      balance_after: 100,
    }),
    true,
  );
  assert.equal(
    isPendingWithdrawLedger({
      type: "WITHDRAW",
      reference: "approved:admin:shop-withdraw:uuid",
      balance_before: 100,
      balance_after: 50,
    }),
    false,
  );
});

test("replay: deposit + MRX fee + MRX win unlocks winnings only", () => {
  const result = replayWithdrawableLedger([
    { type: "DEPOSIT", amount: 1000, reference: "online:dep:1" },
    { type: "BET", amount: 200, reference: "mrx:fee:1" },
    { type: "PAYOUT", amount: 500, reference: "mrx:win:1" },
  ]);
  // 1000 - 200 + 500 = 1300; win 500 is withdrawable; leftover deposit 800 locked
  assert.deepEqual(result, { balance: 1300, withdrawable: 500 });
});

test("replay: deposit + InOut bet + InOut win unlocks winnings", () => {
  const result = replayWithdrawableLedger([
    { type: "DEPOSIT", amount: 1000, reference: "cashier:dep:1" },
    { type: "BET", amount: 100, reference: "inout:bet:a" },
    { type: "PAYOUT", amount: 250, reference: "inout:withdraw:b" },
  ]);
  assert.deepEqual(result, { balance: 1150, withdrawable: 250 });
});

test("replay: InOut rollback does not unlock deposit", () => {
  const result = replayWithdrawableLedger([
    { type: "DEPOSIT", amount: 500, reference: "dep:1" },
    { type: "BET", amount: 100, reference: "inout:bet:1" },
    { type: "PAYOUT", amount: 100, reference: "inout:rollback:1" },
  ]);
  assert.deepEqual(result, { balance: 500, withdrawable: 0 });
});

test("replay: scenario deposit 1000, bet 500, win 1000 → withdrawable 1000", () => {
  const result = replayWithdrawableLedger([
    { type: "DEPOSIT", amount: 1000, reference: "dep" },
    { type: "BET", amount: 500, reference: "mrx:fee:x" },
    { type: "PAYOUT", amount: 1000, reference: "mrx:win:x" },
  ]);
  assert.deepEqual(result, { balance: 1500, withdrawable: 1000 });
});

test("live wallet path: MRX-style win increases withdrawable", async () => {
  const wallet = {
    id: "pw1",
    wallet_type: "PLAYER",
    balance: 0,
    withdrawable: 0,
  };
  const tx = createMockTx(wallet);
  let live = tx.store.get("pw1");

  await creditWallet(tx, live, 1000, { withdrawable: false });
  live = tx.store.get("pw1");
  await debitWallet(tx, live, 200, { fromWithdrawable: false });
  live = tx.store.get("pw1");
  await creditWallet(tx, live, 450.76, { withdrawable: true });
  live = tx.store.get("pw1");

  assert.equal(live.balance, 1250.76);
  assert.equal(live.withdrawable, 450.76);
});

test("live wallet path: InOut-style win increases withdrawable", async () => {
  const wallet = {
    id: "pw1",
    wallet_type: "PLAYER",
    balance: 800,
    withdrawable: 0,
  };
  const tx = createMockTx(wallet);
  let live = tx.store.get("pw1");

  await debitWallet(tx, live, 50, { fromWithdrawable: false });
  live = tx.store.get("pw1");
  await creditWallet(tx, live, 120, { withdrawable: true });
  live = tx.store.get("pw1");

  assert.equal(live.balance, 870);
  assert.equal(live.withdrawable, 120);
});

test("creditWallet throws when withdrawable credit lacks wallet_type", async () => {
  const wallet = { id: "pw1", balance: 100, withdrawable: 0 };
  const tx = createMockTx(wallet);
  await assert.rejects(
    () => creditWallet(tx, wallet, 10, { withdrawable: true }),
    /WALLET_TYPE_MISSING/,
  );
});
