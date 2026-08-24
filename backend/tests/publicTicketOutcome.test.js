/**
 * Public check-ticket outcome (Lost / Won / Bonus).
 * Run: node --test backend/tests/publicTicketOutcome.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePublicTicketOutcome } from "../lib/publicTicketOutcome.js";

const TIERS = [
  { minResult: 20, maxResult: 44, stakeMultiplier: 1 },
  { minResult: 45, maxResult: 79, stakeMultiplier: 2 },
  { minResult: 80, maxResult: 99, stakeMultiplier: 3 },
  { minResult: 100, maxResult: 199, stakeMultiplier: 4 },
  { minResult: 200, maxResult: 399, stakeMultiplier: 5 },
  { minResult: 400, maxResult: null, stakeMultiplier: 10 },
];

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

function makeDb({
  bonus = null,
  selections = [],
  ledger = {},
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
        if (typeof ref === "string" && ledger[ref]) {
          return ledger[ref];
        }
        return null;
      },
    },
  };
}

test("OPEN ticket is pending", async () => {
  const result = await resolvePublicTicketOutcome(makeDb(), {
    id: "tk-1",
    status: "OPEN",
    potential_win: 500,
  });
  assert.deepEqual(result, { outcome: "pending", outcomeAmount: null });
});

test("PRINTED and HELD tickets are pending", async () => {
  for (const status of ["PRINTED", "HELD"]) {
    const result = await resolvePublicTicketOutcome(makeDb(), {
      id: "tk-1",
      status,
      potential_win: 500,
    });
    assert.equal(result.outcome, "pending");
    assert.equal(result.outcomeAmount, null);
  }
});

test("WON uses net payout after tax", async () => {
  const result = await resolvePublicTicketOutcome(makeDb(), {
    id: "tk-1",
    status: "WON",
    potential_win: 1000,
    apply_winnings_tax: true,
    winnings_tax_rate: 0.15,
  });
  assert.equal(result.outcome, "won");
  assert.equal(result.outcomeAmount, 850);
});

test("PAID uses net payout after tax", async () => {
  const result = await resolvePublicTicketOutcome(makeDb(), {
    id: "tk-1",
    status: "PAID",
    potential_win: 200,
    apply_winnings_tax: false,
    winnings_tax_rate: null,
  });
  assert.equal(result.outcome, "won");
  assert.equal(result.outcomeAmount, 200);
});

test("LOST without cashback is lost", async () => {
  const result = await resolvePublicTicketOutcome(
    makeDb({
      bonus: null,
      selections: lostSelections(3, 1.8),
    }),
    {
      id: "tk-1",
      status: "LOST",
      stake: 30,
      total_odds: 8,
      created_at: new Date(),
    },
  );
  assert.deepEqual(result, { outcome: "lost", outcomeAmount: null });
});

test("LOST with online cashback ledger is bonus", async () => {
  const result = await resolvePublicTicketOutcome(
    makeDb({
      ledger: { "bonus:cashback:tk-1": { amount: 50 } },
    }),
    {
      id: "tk-1",
      status: "LOST",
      stake: 30,
      total_odds: 8,
    },
  );
  assert.deepEqual(result, { outcome: "bonus", outcomeAmount: 50 });
});

test("CASHBACK_PAID uses cashier payout ledger", async () => {
  const result = await resolvePublicTicketOutcome(
    makeDb({
      ledger: { "cashback-payout:tk-1": { amount: 150 } },
    }),
    {
      id: "tk-1",
      status: "CASHBACK_PAID",
    },
  );
  assert.deepEqual(result, { outcome: "bonus", outcomeAmount: 150 });
});

test("LOST eligible unpaid cashback is bonus (quoted amount)", async () => {
  const result = await resolvePublicTicketOutcome(
    makeDb({
      bonus: activeBonus,
      selections: lostSelections(10, 1.63),
    }),
    {
      id: "tk-1",
      status: "LOST",
      user_id: "player-1",
      stake: 30,
      total_odds: 500.99,
      created_at: new Date(),
    },
  );
  assert.equal(result.outcome, "bonus");
  assert.equal(result.outcomeAmount, 150);
});

test("LOST with pending legs is lost, not a prospective bonus", async () => {
  const sels = lostSelections(10, 1.63);
  sels[0].result = "PENDING";
  const result = await resolvePublicTicketOutcome(
    makeDb({
      bonus: activeBonus,
      selections: sels,
    }),
    {
      id: "tk-1",
      status: "LOST",
      user_id: "player-1",
      stake: 30,
      total_odds: 500.99,
      created_at: new Date(),
    },
  );
  assert.equal(result.outcome, "lost");
  assert.equal(result.outcomeAmount, null);
});

test("VOID and cancelled statuses are not Lost/Won/Bonus", async () => {
  const voided = await resolvePublicTicketOutcome(makeDb(), {
    id: "tk-1",
    status: "VOID",
  });
  assert.deepEqual(voided, { outcome: "void", outcomeAmount: null });

  const canceled = await resolvePublicTicketOutcome(makeDb(), {
    id: "tk-1",
    status: "CANCELED",
  });
  assert.deepEqual(canceled, { outcome: "cancelled", outcomeAmount: null });

  const cashed = await resolvePublicTicketOutcome(makeDb(), {
    id: "tk-1",
    status: "CASHED_OUT",
  });
  assert.deepEqual(cashed, { outcome: "cancelled", outcomeAmount: null });
});
