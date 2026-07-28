/**
 * Run: node --test backend/tests/bonusEngine.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAccumulatorPercent,
  computeStackedDepositBonusAmount,
  computeWelcomeFlatAmount,
  computeCashbackAmount,
  evaluateCashback,
  pickCashbackTier,
  potentialWinWithAccumulator,
  roundMoney,
} from "../lib/bonusEngine.js";

const TIERS = [
  { minResult: 20, maxResult: 44, stakeMultiplier: 1 },
  { minResult: 45, maxResult: 79, stakeMultiplier: 2 },
  { minResult: 80, maxResult: 99, stakeMultiplier: 3 },
  { minResult: 100, maxResult: 199, stakeMultiplier: 4 },
  { minResult: 200, maxResult: 399, stakeMultiplier: 5 },
  { minResult: 400, maxResult: null, stakeMultiplier: 10 },
];

function tieredBonus(overrides = {}) {
  return {
    type: "CASHBACK",
    status: true,
    percentage: 0,
    rules: {
      minSelections: 2,
      minStake: 10,
      maxHours: 72,
      minResult: 20,
      tiers: TIERS,
      ...overrides,
    },
  };
}

/** Build N selections, the last one LOST with `lostOdds`, the rest WON. */
function selections(count, lostOdds) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      result: i === count - 1 ? "LOST" : "WON",
      odds: i === count - 1 ? lostOdds : 1.5,
    });
  }
  return out;
}

test("computeWelcomeFlatAmount uses fixedAmount then percentage as flat", () => {
  assert.equal(
    computeWelcomeFlatAmount({
      type: "WELCOME",
      status: true,
      percentage: 0,
      rules: { fixedAmount: 50 },
    }),
    50,
  );
  assert.equal(
    computeWelcomeFlatAmount({
      type: "WELCOME",
      status: true,
      percentage: 25,
      rules: {},
    }),
    25,
  );
});

test("first deposit stacks as max of FIRST_DEPOSIT and DEPOSIT", () => {
  const first = {
    type: "FIRST_DEPOSIT",
    status: true,
    percentage: 50,
    min_deposit: 0,
  };
  const dep = {
    type: "DEPOSIT",
    status: true,
    percentage: 10,
    min_deposit: 0,
  };
  assert.equal(
    computeStackedDepositBonusAmount(first, dep, 100, true),
    50,
  );
  assert.equal(
    computeStackedDepositBonusAmount(first, dep, 100, false),
    10,
  );
});

test("computeAccumulatorPercent picks highest matching tier", () => {
  const bonus = {
    type: "ACCUMULATOR",
    status: true,
    percentage: 0,
    rules: {
      tiers: [
        { minLegs: 3, bonusPercent: 1 },
        { minLegs: 5, bonusPercent: 5 },
      ],
    },
  };
  assert.equal(computeAccumulatorPercent(bonus, 2), 0);
  assert.equal(computeAccumulatorPercent(bonus, 4), 1);
  assert.equal(computeAccumulatorPercent(bonus, 5), 5);
});

test("potentialWinWithAccumulator", () => {
  assert.equal(potentialWinWithAccumulator(10, 2, 10), roundMoney(10 * 2 * 1.1));
});

test("computeCashbackAmount (legacy flat) respects minTotalOdds", () => {
  const bonus = {
    type: "CASHBACK",
    status: true,
    percentage: 0,
    rules: { minTotalOdds: 2, percentOfStake: 5 },
  };
  const ticket = { user_id: "u1", stake: 100, total_odds: 1.5 };
  assert.equal(computeCashbackAmount(ticket, bonus), 0);
  assert.equal(
    computeCashbackAmount({ user_id: "u1", stake: 100, total_odds: 3 }, bonus),
    5,
  );
});

test("pickCashbackTier matches inclusive ranges and open-ended last tier", () => {
  assert.equal(pickCashbackTier(19.99, TIERS), null);
  assert.equal(pickCashbackTier(20, TIERS).stakeMultiplier, 1);
  assert.equal(pickCashbackTier(44, TIERS).stakeMultiplier, 1);
  assert.equal(pickCashbackTier(45, TIERS).stakeMultiplier, 2);
  assert.equal(pickCashbackTier(99, TIERS).stakeMultiplier, 3);
  assert.equal(pickCashbackTier(199, TIERS).stakeMultiplier, 4);
  assert.equal(pickCashbackTier(399, TIERS).stakeMultiplier, 5);
  assert.equal(pickCashbackTier(400, TIERS).stakeMultiplier, 10);
  assert.equal(pickCashbackTier(99999, TIERS).stakeMultiplier, 10);
});

test("evaluateCashback worked example: 96 odds / 2.3 lost = 41.73 -> stake x1", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    bonus: tieredBonus(),
    now: new Date(),
  });
  assert.equal(ev.eligible, true);
  assert.equal(ev.tier.stakeMultiplier, 1);
  assert.equal(ev.amount, 10);
});

test("evaluateCashback uses the largest lost-leg odds (conservative)", () => {
  // total 300, two LOST legs (2.0 and 3.0) -> 300/3 = 100 -> x4
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 300, created_at: new Date() },
    selections: [
      { result: "WON", odds: 1.5 },
      { result: "LOST", odds: 2.0 },
      { result: "LOST", odds: 3.0 },
    ],
    bonus: tieredBonus(),
    now: new Date(),
  });
  assert.equal(ev.result, 100);
  assert.equal(ev.tier.stakeMultiplier, 4);
  assert.equal(ev.amount, 40);
});

test("evaluateCashback gate: selection count must be greater than minSelections", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(2, 2.3), // minSelections is 2 -> needs > 2
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "too_few_selections");
});

test("evaluateCashback gate: stake below minStake", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 5, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "below_min_stake");
});

test("evaluateCashback gate: outside time window", () => {
  const created = new Date(Date.now() - 100 * 60 * 60 * 1000); // 100h ago
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: created },
    selections: selections(3, 2.3),
    bonus: tieredBonus({ maxHours: 72 }),
    now: new Date(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "outside_time_window");
});

test("evaluateCashback gate: any disqualified fixture status voids cashback", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    fixtureStatuses: ["FT", "PST", "FT"],
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "disqualified_selection");
});

test("evaluateCashback gate: any disqualified match status voids cashback", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    matchStatuses: ["FINISHED", "SUSPENDED"],
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "disqualified_selection");
});

test("evaluateCashback gate: result below minResult", () => {
  // 40 / 2.3 = 17.39 < 20
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 40, created_at: new Date() },
    selections: selections(3, 2.3),
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "below_min_result");
});

test("computeCashbackAmount uses tiered path when rules.tiers present", () => {
  const amount = computeCashbackAmount(
    { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    tieredBonus(),
    { selections: selections(3, 2.3), now: new Date() },
  );
  assert.equal(amount, 10);
});

test("evaluateCashback allows cashier tickets without user_id", () => {
  const ev = evaluateCashback({
    ticket: {
      user_id: null,
      stake: 30,
      total_odds: 500.99,
      created_at: new Date(),
    },
    selections: selections(10, 1.63),
    bonus: tieredBonus({ minSelections: 7, minStake: 20 }),
    now: new Date(),
  });
  // 500.99 / 1.63 ≈ 307.36 → 200–399 tier → ×5 → 150
  assert.equal(ev.eligible, true);
  assert.equal(ev.tier.stakeMultiplier, 5);
  assert.equal(ev.amount, 150);
});

test("evaluateCashback reported slip: 10 legs, stake 30, 500.99/1.63 → ×5", () => {
  const ev = evaluateCashback({
    ticket: {
      user_id: "u1",
      stake: 30,
      total_odds: 500.99,
      created_at: new Date(),
    },
    selections: selections(10, 1.63),
    bonus: tieredBonus({ minSelections: 7, minStake: 20, maxHours: 72 }),
    now: new Date(),
  });
  assert.ok(ev.result > 307 && ev.result < 308);
  assert.equal(ev.tier.stakeMultiplier, 5);
  assert.equal(ev.amount, 150);
});
