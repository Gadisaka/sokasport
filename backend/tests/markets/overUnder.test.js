import { test } from "node:test";
import assert from "node:assert/strict";
import ou from "../../services/markets/overUnder.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (h, a) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
});

test("OVER_UNDER: Over 2.5 on 2-1 (total 3) → WON", () => {
  assert.equal(
    ou.evaluate({ market_params: { side: "OVER", line: 2.5 } }, mr(2, 1)).result,
    "WON",
  );
});

test("OVER_UNDER: Under 2.5 on 2-1 → LOST", () => {
  assert.equal(
    ou.evaluate({ market_params: { side: "UNDER", line: 2.5 } }, mr(2, 1)).result,
    "LOST",
  );
});

test("OVER_UNDER: push on integer line (total 3, line 3) → VOID", () => {
  const r = ou.evaluate({ market_params: { side: "OVER", line: 3 } }, mr(2, 1));
  assert.equal(r.result, "VOID");
  assert.equal(r.reason, "push");
});

test("OVER_UNDER: 0-0 Under 0.5 → WON (regression)", () => {
  assert.equal(
    ou.evaluate({ market_params: { side: "UNDER", line: 0.5 } }, mr(0, 0)).result,
    "WON",
  );
});

test("OVER_UNDER: validate rejects invalid line step", () => {
  assert.throws(() => ou.validate({ side: "OVER", line: 2.3 }), ValidationError);
});

test("OVER_UNDER: validate rejects missing side", () => {
  assert.throws(() => ou.validate({ line: 2.5 }), ValidationError);
});
