import { test } from "node:test";
import assert from "node:assert/strict";
import matchWinner from "../../services/markets/matchWinner.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (home, away, overrides = {}) => ({
  schemaVersion: 2,
  source: "FIXTURE",
  finality: "FINAL",
  scores: { fullTime: { home, away }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
  ...overrides,
});

test("MATCH_WINNER: HOME wins on 2-1", () => {
  const r = matchWinner.evaluate({ market_params: { side: "HOME" } }, mr(2, 1));
  assert.equal(r.result, "WON");
});

test("MATCH_WINNER: DRAW on 1-1", () => {
  const r = matchWinner.evaluate({ market_params: { side: "DRAW" } }, mr(1, 1));
  assert.equal(r.result, "WON");
});

test("MATCH_WINNER: AWAY loses on 2-1", () => {
  const r = matchWinner.evaluate({ market_params: { side: "AWAY" } }, mr(2, 1));
  assert.equal(r.result, "LOST");
});

test("MATCH_WINNER: validate rejects invalid side", () => {
  assert.throws(() => matchWinner.validate({ side: "INVALID" }), ValidationError);
});

test("MATCH_WINNER: canEvaluate false without scores", () => {
  assert.equal(
    matchWinner.canEvaluate({ scores: { fullTime: { home: null, away: null } } }),
    false,
  );
});

test("MATCH_WINNER: admin resultLabel fallback grades without scores", () => {
  const r = matchWinner.evaluate(
    { market_params: { side: "HOME" } },
    {
      scores: { fullTime: { home: null, away: null } },
      resultLabel: "1",
    },
  );
  assert.equal(r.result, "WON");
});

test("MATCH_WINNER: alias normalization '1'/'X'/'2'", () => {
  assert.deepEqual(matchWinner.validate({ side: "1" }), { side: "HOME" });
  assert.deepEqual(matchWinner.validate({ side: "X" }), { side: "DRAW" });
  assert.deepEqual(matchWinner.validate({ side: "2" }), { side: "AWAY" });
});
