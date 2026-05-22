import assert from "node:assert/strict";
import test from "node:test";
import {
  BETTING_LIMIT_KEYS,
  capGrossPotentialWin,
  getDepositAmountViolation,
  getStakeAndPotentialWinViolation,
  getWithdrawAmountViolation,
} from "../lib/bettingLimits.js";

const SAMPLE_FINANCIAL = {
  MIN_BET_AMOUNT: 50,
  MAX_BET_AMOUNT: 1000,
  MAX_WINNING_AMOUNT: 100_000,
  MIN_DEPOSIT: 60,
  MAX_DEPOSIT: 50_000,
  MIN_WITHDRAW: 500,
  MAX_WITHDRAW: 10_000,
};

test("getStakeAndPotentialWinViolation enforces MIN / MAX stake only", () => {
  assert.match(
    getStakeAndPotentialWinViolation(SAMPLE_FINANCIAL, 20, 200),
    /Minimum stake is 50/,
  );

  assert.equal(
    getStakeAndPotentialWinViolation(SAMPLE_FINANCIAL, 50, 4999),
    null,
  );

  assert.match(
    getStakeAndPotentialWinViolation(SAMPLE_FINANCIAL, 1100, 5500),
    /Maximum stake is 1000/,
  );

  assert.equal(
    getStakeAndPotentialWinViolation(SAMPLE_FINANCIAL, 999, 100_001),
    null,
  );
});

test("capGrossPotentialWin clamps to MAX_WINNING_AMOUNT", () => {
  assert.equal(capGrossPotentialWin(SAMPLE_FINANCIAL, 100_001), 100_000);
  assert.equal(capGrossPotentialWin(SAMPLE_FINANCIAL, 50_000), 50_000);
  const noMax = { ...SAMPLE_FINANCIAL, MAX_WINNING_AMOUNT: null };
  assert.equal(capGrossPotentialWin(noMax, 100_001), 100_001);
});

test("getWithdrawAmountViolation mirrors shop-withdraw boundaries", () => {
  assert.match(
    getWithdrawAmountViolation(SAMPLE_FINANCIAL, 100),
    /Minimum withdrawal is 500/,
  );

  assert.match(
    getWithdrawAmountViolation(SAMPLE_FINANCIAL, 12_345),
    /Maximum withdrawal is 10000/,
  );

  assert.equal(getWithdrawAmountViolation(SAMPLE_FINANCIAL, 1000), null);
});

test("getDepositAmountViolation mirrors online deposit boundaries", () => {
  assert.match(
    getDepositAmountViolation(SAMPLE_FINANCIAL, 10),
    /Minimum deposit is 60/,
  );

  assert.match(
    getDepositAmountViolation(SAMPLE_FINANCIAL, 99_999),
    /Maximum deposit is 50000/,
  );

  assert.equal(getDepositAmountViolation(SAMPLE_FINANCIAL, 5000), null);
});

test("BETTING_LIMIT_KEYS stays aligned with settings UI (7 numeric limits)", () => {
  assert.equal(BETTING_LIMIT_KEYS.length, 7);
});
