import assert from "node:assert/strict";
import test from "node:test";
import {
  canConsumeOddsBudget,
  oddsBudgetKey,
} from "../services/apiBudget.js";

test("canConsumeOddsBudget allows when budget disabled (0)", () => {
  assert.equal(canConsumeOddsBudget(999999, 0, 1), true);
});

test("canConsumeOddsBudget blocks when used would exceed budget", () => {
  assert.equal(canConsumeOddsBudget(69999, 70000, 1), true);
  assert.equal(canConsumeOddsBudget(70000, 70000, 1), false);
  assert.equal(canConsumeOddsBudget(69950, 70000, 100), false);
});

test("oddsBudgetKey is UTC-ymd scoped", () => {
  assert.match(oddsBudgetKey("2026-07-17"), /^api-budget:odds:2026-07-17$/);
});
