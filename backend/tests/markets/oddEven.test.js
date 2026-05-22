import { test } from "node:test";
import assert from "node:assert/strict";
import oddEven from "../../services/markets/oddEven.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (h, a) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
});

test("ODD_EVEN: ODD on 2-1 (total 3) → WON", () => {
  assert.equal(oddEven.evaluate({ market_params: { pick: "ODD" } }, mr(2, 1)).result, "WON");
});

test("ODD_EVEN: EVEN on 2-2 (total 4) → WON", () => {
  assert.equal(oddEven.evaluate({ market_params: { pick: "EVEN" } }, mr(2, 2)).result, "WON");
});

test("ODD_EVEN: EVEN on 0-0 → WON (regression: 0 is even)", () => {
  assert.equal(oddEven.evaluate({ market_params: { pick: "EVEN" } }, mr(0, 0)).result, "WON");
});

test("ODD_EVEN: validate rejects garbage", () => {
  assert.throws(() => oddEven.validate({ pick: "ODDISH" }), ValidationError);
});
