import { test } from "node:test";
import assert from "node:assert/strict";
import dnb from "../../services/markets/drawNoBet.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (h, a) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
});

test("DRAW_NO_BET: HOME wins 2-1 → WON", () => {
  assert.equal(
    dnb.evaluate({ market_params: { side: "HOME" } }, mr(2, 1)).result,
    "WON",
  );
});

test("DRAW_NO_BET: draw 1-1 → VOID (refund)", () => {
  const r = dnb.evaluate({ market_params: { side: "HOME" } }, mr(1, 1));
  assert.equal(r.result, "VOID");
  assert.equal(r.reason, "draw_refund");
});

test("DRAW_NO_BET: AWAY loses 2-1 → LOST", () => {
  assert.equal(
    dnb.evaluate({ market_params: { side: "AWAY" } }, mr(2, 1)).result,
    "LOST",
  );
});

test("DRAW_NO_BET: validate rejects DRAW as side", () => {
  assert.throws(() => dnb.validate({ side: "DRAW" }), ValidationError);
});
