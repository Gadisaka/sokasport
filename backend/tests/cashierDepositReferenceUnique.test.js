/**
 * Cashier deposit ledger references must be unique: Transaction.reference is
 * @unique, and each deposit writes both a cashier WITHDRAW and a player DEPOSIT.
 *
 * Run: node --test tests/cashierDepositReferenceUnique.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  clearUniqueReferences,
  prisma,
  resetStore,
} from "./fixtures/prismaInMemoryStub.js";

test("identical cashier-deposit references collide under @unique (regression)", async () => {
  resetStore();
  clearUniqueReferences();

  const sharedRef = `cashier-deposit:cashier-user-1:to:player-user-1`;

  await prisma.transaction.create({
    data: {
      wallet_id: "cashier-wallet",
      type: "WITHDRAW",
      amount: 100,
      balance_before: 500,
      balance_after: 400,
      reference: sharedRef,
    },
  });

  await assert.rejects(
    () =>
      prisma.transaction.create({
        data: {
          wallet_id: "player-wallet",
          type: "DEPOSIT",
          amount: 100,
          balance_before: 0,
          balance_after: 100,
          reference: sharedRef,
        },
      }),
    (err) => err?.code === "P2002",
  );
});

test("distinct cashier/player deposit refs with depositId succeed", async () => {
  resetStore();
  clearUniqueReferences();

  const depositId = randomUUID();
  const cashierRef = `cashier-deposit:c1:to:p1:${depositId}:cashier`;
  const playerRef = `cashier-deposit:c1:to:p1:${depositId}:player`;

  assert.notEqual(cashierRef, playerRef);

  const a = await prisma.transaction.create({
    data: {
      wallet_id: "cashier-wallet",
      type: "WITHDRAW",
      amount: 100,
      balance_before: 500,
      balance_after: 400,
      reference: cashierRef,
    },
  });
  const b = await prisma.transaction.create({
    data: {
      wallet_id: "player-wallet",
      type: "DEPOSIT",
      amount: 100,
      balance_before: 0,
      balance_after: 100,
      reference: playerRef,
    },
  });

  assert.ok(a.id);
  assert.ok(b.id);
  assert.notEqual(a.id, b.id);
});
