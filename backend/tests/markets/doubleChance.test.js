import { test } from "node:test";
import assert from "node:assert/strict";
import dc from "../../services/markets/doubleChance.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (h, a) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
});

test("DOUBLE_CHANCE: 1X on 1-1 → WON", () => {
  const r = dc.evaluate({ market_params: { combination: "1X" } }, mr(1, 1));
  assert.equal(r.result, "WON");
});

test("DOUBLE_CHANCE: 12 on 0-0 → LOST", () => {
  const r = dc.evaluate({ market_params: { combination: "12" } }, mr(0, 0));
  assert.equal(r.result, "LOST");
});

test("DOUBLE_CHANCE: X2 on 0-2 → WON", () => {
  const r = dc.evaluate({ market_params: { combination: "X2" } }, mr(0, 2));
  assert.equal(r.result, "WON");
});

test("DOUBLE_CHANCE: validates and normalizes aliases", () => {
  assert.deepEqual(dc.validate({ combination: "HOME/DRAW" }), { combination: "1X" });
  assert.deepEqual(dc.validate({ combination: "DRAW_OR_AWAY" }), { combination: "X2" });
});

test("DOUBLE_CHANCE: rejects invalid combination", () => {
  assert.throws(() => dc.validate({ combination: "1Y" }), ValidationError);
});
