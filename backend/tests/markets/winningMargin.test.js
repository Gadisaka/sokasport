import { test } from "node:test";
import assert from "node:assert/strict";
import wm from "../../services/markets/winningMargin.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (h, a) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
});

test("WINNING_MARGIN: HOME by exactly 2 on 3-1 → WON", () => {
  assert.equal(
    wm.evaluate({ market_params: { side: "HOME", margin: 2 } }, mr(3, 1)).result,
    "WON",
  );
});

test("WINNING_MARGIN: HOME by 1-2 range on 3-1 (margin 2) → WON", () => {
  assert.equal(
    wm.evaluate(
      { market_params: { side: "HOME", margin: { min: 1, max: 2 } } },
      mr(3, 1),
    ).result,
    "WON",
  );
});

test("WINNING_MARGIN: HOME by 3+ on 3-1 → LOST", () => {
  assert.equal(
    wm.evaluate({ market_params: { side: "HOME", margin: 3 } }, mr(3, 1)).result,
    "LOST",
  );
});

test("WINNING_MARGIN: DRAW on 2-2 → WON", () => {
  assert.equal(
    wm.evaluate({ market_params: { side: "DRAW" } }, mr(2, 2)).result,
    "WON",
  );
});

test("WINNING_MARGIN: DRAW on 3-2 → LOST", () => {
  assert.equal(
    wm.evaluate({ market_params: { side: "DRAW" } }, mr(3, 2)).result,
    "LOST",
  );
});

test("WINNING_MARGIN: AWAY pick but HOME wins → LOST (regression)", () => {
  assert.equal(
    wm.evaluate({ market_params: { side: "AWAY", margin: 1 } }, mr(3, 1)).result,
    "LOST",
  );
});

test("WINNING_MARGIN: validate rejects missing margin for non-draw", () => {
  assert.throws(() => wm.validate({ side: "HOME" }), ValidationError);
});

test("WINNING_MARGIN: validate accepts 'x-y' string form", () => {
  assert.deepEqual(wm.validate({ side: "HOME", margin: "1-3" }), {
    side: "HOME",
    margin: { min: 1, max: 3 },
  });
});
