import { test } from "node:test";
import assert from "node:assert/strict";
import btts from "../../services/markets/btts.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (h, a) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
});

test("BTTS: YES on 2-1 → WON", () => {
  assert.equal(btts.evaluate({ market_params: { pick: "YES" } }, mr(2, 1)).result, "WON");
});

test("BTTS: YES on 0-0 → LOST", () => {
  assert.equal(btts.evaluate({ market_params: { pick: "YES" } }, mr(0, 0)).result, "LOST");
});

test("BTTS: NO on 1-0 → WON (regression: one-sided)", () => {
  assert.equal(btts.evaluate({ market_params: { pick: "NO" } }, mr(1, 0)).result, "WON");
});

test("BTTS: NO on 0-0 → WON (regression: nil-nil)", () => {
  assert.equal(btts.evaluate({ market_params: { pick: "NO" } }, mr(0, 0)).result, "WON");
});

test("BTTS: validate rejects unknown pick", () => {
  assert.throws(() => btts.validate({ pick: "MAYBE" }), ValidationError);
});
