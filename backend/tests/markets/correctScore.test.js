import { test } from "node:test";
import assert from "node:assert/strict";
import cs from "../../services/markets/correctScore.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (h, a) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
});

test("CORRECT_SCORE: exact match 2-1 → WON", () => {
  assert.equal(
    cs.evaluate({ market_params: { home: 2, away: 1 } }, mr(2, 1)).result,
    "WON",
  );
});

test("CORRECT_SCORE: 2-0 lost when actual is 2-1 → LOST", () => {
  assert.equal(
    cs.evaluate({ market_params: { home: 2, away: 0 } }, mr(2, 1)).result,
    "LOST",
  );
});

test("CORRECT_SCORE: 4-4 handled correctly (regression — commonly offered)", () => {
  assert.equal(
    cs.evaluate({ market_params: { home: 4, away: 4 } }, mr(4, 4)).result,
    "WON",
  );
  assert.equal(
    cs.evaluate({ market_params: { home: 4, away: 3 } }, mr(4, 4)).result,
    "LOST",
  );
});

test("CORRECT_SCORE: validate rejects negative scores", () => {
  assert.throws(() => cs.validate({ home: -1, away: 0 }), ValidationError);
});

test("CORRECT_SCORE: validate rejects insane scores (> 15)", () => {
  assert.throws(() => cs.validate({ home: 99, away: 0 }), ValidationError);
});
