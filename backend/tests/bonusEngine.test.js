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
  potentialWinWithAccumulator,
  roundMoney,
} from "../lib/bonusEngine.js";

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

test("computeCashbackAmount respects minTotalOdds", () => {
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
