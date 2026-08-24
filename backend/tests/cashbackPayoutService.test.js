/**
 * Claim-time cashback quote for cashier-printed LOST tickets.
 * Run: node --test backend/tests/cashbackPayoutService.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCashbackQuote } from "../services/cashbackPayoutService.js";
import { DEFAULT_CASHBACK_RULES } from "../lib/ensureBonusPresets.js";

const TIERS = [
  { minResult: 20, maxResult: 44, stakeMultiplier: 1 },
  { minResult: 45, maxResult: 79, stakeMultiplier: 2 },
  { minResult: 80, maxResult: 99, stakeMultiplier: 3 },
  { minResult: 100, maxResult: 199, stakeMultiplier: 4 },
  { minResult: 200, maxResult: 399, stakeMultiplier: 5 },
  { minResult: 400, maxResult: null, stakeMultiplier: 10 },
];

function makeDb({
  bonus = null,
  selections = [],
  printTx = true,
  payoutTx = false,
  fixtures = [],
  matches = [],
} = {}) {
  return {
    bonus: {
      findFirst: async () => bonus,
    },
    ticketSelection: {
      findMany: async () => selections,
    },
    fixture: {
      findMany: async () => fixtures,
    },
    match: {
      findMany: async () => matches,
    },
    transaction: {
      findFirst: async ({ where }) => {
        const ref = where?.reference;
        if (typeof ref === "string" && ref.startsWith("ticket-print:")) {
          return printTx ? { id: "print-1" } : null;
        }
        if (typeof ref === "string" && ref.startsWith("cashback-payout:")) {
          return payoutTx ? { id: "cb-1" } : null;
        }
        return null;
      },
    },
  };
}

function lostSelections(count, lostOdds) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `sel-${i}`,
      ticket_id: "tk-1",
      fixture_id: `fx-${i}`,
      match_id: null,
      result: i === count - 1 ? "LOST" : "WON",
      odds: i === count - 1 ? lostOdds : 1.5,
    });
  }
  return out;
}

const activeBonus = {
  type: "CASHBACK",
  status: true,
  percentage: 0,
  rules: {
    minSelections: 7,
    minStake: 20,
    maxHours: 72,
    minResult: 20,
    tiers: TIERS,
  },
};

test("buildCashbackQuote: printed LOST ticket eligible (reported slip math)", async () => {
  const ticket = {
    id: "tk-1",
    status: "LOST",
    user_id: null,
    stake: 30,
    total_odds: 500.99,
    created_at: new Date(),
  };
  const quote = await buildCashbackQuote(
    makeDb({
      bonus: activeBonus,
      selections: lostSelections(10, 1.63),
      printTx: true,
    }),
    ticket,
  );
  assert.equal(quote.allowed, true);
  assert.equal(quote.amount, 150);
  assert.equal(quote.tier.stakeMultiplier, 5);
  assert.equal(quote.reasonCode, "eligible");
});

test("buildCashbackQuote: rejects non-LOST tickets", async () => {
  const quote = await buildCashbackQuote(
    makeDb({ bonus: activeBonus, printTx: true }),
    {
      id: "tk-1",
      status: "WON",
      stake: 30,
      total_odds: 500.99,
      created_at: new Date(),
    },
  );
  assert.equal(quote.allowed, false);
  assert.equal(quote.reasonCode, "ticket_not_lost");
});

test("buildCashbackQuote: rejects non-printed tickets", async () => {
  const quote = await buildCashbackQuote(
    makeDb({
      bonus: activeBonus,
      selections: lostSelections(10, 1.63),
      printTx: false,
    }),
    {
      id: "tk-1",
      status: "LOST",
      stake: 30,
      total_odds: 500.99,
      created_at: new Date(),
    },
  );
  assert.equal(quote.allowed, false);
  assert.equal(quote.reasonCode, "not_cashier_ticket");
});

test("buildCashbackQuote: already paid via CASHBACK_PAID status", async () => {
  const quote = await buildCashbackQuote(
    makeDb({ bonus: activeBonus, printTx: true }),
    {
      id: "tk-1",
      status: "CASHBACK_PAID",
      stake: 30,
      total_odds: 500.99,
      created_at: new Date(),
    },
  );
  assert.equal(quote.allowed, false);
  assert.equal(quote.reasonCode, "already_paid");
});

test("buildCashbackQuote: already paid via ledger reference", async () => {
  const quote = await buildCashbackQuote(
    makeDb({
      bonus: activeBonus,
      selections: lostSelections(10, 1.63),
      printTx: true,
      payoutTx: true,
    }),
    {
      id: "tk-1",
      status: "LOST",
      stake: 30,
      total_odds: 500.99,
      created_at: new Date(),
    },
  );
  assert.equal(quote.allowed, false);
  assert.equal(quote.reasonCode, "already_paid");
});

test("buildCashbackQuote: outside time window at claim time", async () => {
  const created = new Date(Date.now() - 100 * 60 * 60 * 1000);
  const quote = await buildCashbackQuote(
    makeDb({
      bonus: activeBonus,
      selections: lostSelections(10, 1.63),
      printTx: true,
    }),
    {
      id: "tk-1",
      status: "LOST",
      stake: 30,
      total_odds: 500.99,
      created_at: created,
    },
    { now: new Date() },
  );
  assert.equal(quote.allowed, false);
  assert.equal(quote.reasonCode, "outside_time_window");
});

const v3Bonus = {
  type: "CASHBACK",
  status: true,
  percentage: 0,
  rules: DEFAULT_CASHBACK_RULES,
};

test("buildCashbackQuote: v3 printed slip uses offline stake floor and returns profileKey", async () => {
  const ticket = {
    id: "tk-1",
    status: "LOST",
    user_id: null,
    stake: 20,
    total_odds: 80,
    created_at: new Date(),
  };
  const quote = await buildCashbackQuote(
    makeDb({
      bonus: v3Bonus,
      selections: lostSelections(5, 2),
      printTx: true,
    }),
    ticket,
  );
  // 80 / 2 = 40 → 1-loss 40–59 → ×2 → 40
  assert.equal(quote.allowed, true);
  assert.equal(quote.amount, 40);
  assert.equal(quote.tier.stakeMultiplier, 2);
  assert.equal(quote.profileKey, "oneLoss");
  assert.equal(quote.reasonCode, "eligible");
});

test("buildCashbackQuote: v3 printed slip below offline min stake is denied", async () => {
  const quote = await buildCashbackQuote(
    makeDb({
      bonus: v3Bonus,
      selections: lostSelections(5, 2),
      printTx: true,
    }),
    {
      id: "tk-1",
      status: "LOST",
      user_id: null,
      stake: 19,
      total_odds: 80,
      created_at: new Date(),
    },
  );
  assert.equal(quote.allowed, false);
  assert.equal(quote.reasonCode, "below_min_stake");
  assert.equal(quote.profileKey, "oneLoss");
});

test("buildCashbackQuote: v3 public path treats missing print tx as online", async () => {
  const quote = await buildCashbackQuote(
    makeDb({
      bonus: v3Bonus,
      selections: lostSelections(5, 2),
      printTx: false,
    }),
    {
      id: "tk-1",
      status: "LOST",
      user_id: "u1",
      stake: 10,
      total_odds: 80,
      created_at: new Date(),
    },
    { requirePrinted: false },
  );
  assert.equal(quote.allowed, true);
  assert.equal(quote.amount, 20);
  assert.equal(quote.profileKey, "oneLoss");
});
