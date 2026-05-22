import { test } from "node:test";
import assert from "node:assert/strict";
import htr from "../../services/markets/halfTimeResult.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (hh, ha) => ({
  finality: "FINAL",
  scores: {
    fullTime: { home: 3, away: 3 }, // irrelevant
    halfTime: { home: hh, away: ha },
  },
  stats: {},
  events: [],
});

test("HALF_TIME_RESULT: HOME HT on 1-0 → WON", () => {
  assert.equal(
    htr.evaluate({ market_params: { side: "HOME" } }, mr(1, 0)).result,
    "WON",
  );
});

test("HALF_TIME_RESULT: DRAW HT on 0-0 → WON (regression)", () => {
  assert.equal(
    htr.evaluate({ market_params: { side: "DRAW" } }, mr(0, 0)).result,
    "WON",
  );
});

test("HALF_TIME_RESULT: canEvaluate false without HT scores", () => {
  assert.equal(
    htr.canEvaluate({ scores: { halfTime: { home: null, away: null } } }),
    false,
  );
});

test("HALF_TIME_RESULT: validate rejects invalid side", () => {
  assert.throws(() => htr.validate({ side: "Q" }), ValidationError);
});
