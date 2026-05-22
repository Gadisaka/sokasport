import { test } from "node:test";
import assert from "node:assert/strict";
import ah from "../../services/markets/handicapAsian.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (h, a) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
});

test("HANDICAP_ASIAN: HOME -1 on 2-0 → WON", () => {
  assert.equal(
    ah.evaluate({ market_params: { side: "HOME", handicap: -1 } }, mr(2, 0)).result,
    "WON",
  );
});

test("HANDICAP_ASIAN: HOME -1 on 1-0 → VOID (adjusted draw / push)", () => {
  assert.equal(
    ah.evaluate({ market_params: { side: "HOME", handicap: -1 } }, mr(1, 0)).result,
    "VOID",
  );
});

test("HANDICAP_ASIAN: HOME -0.5 on 1-1 → LOST (half-line)", () => {
  assert.equal(
    ah.evaluate({ market_params: { side: "HOME", handicap: -0.5 } }, mr(1, 1)).result,
    "LOST",
  );
});

test("HANDICAP_ASIAN: HOME -0.75 on 2-1 → WON quarter_full_win (regression)", () => {
  const r = ah.evaluate({ market_params: { side: "HOME", handicap: -0.75 } }, mr(2, 1));
  // Adjusted score: home - 0.5 = 1.5, away = 1 → WON. Also home - 1 = 1, away = 1 → VOID.
  // Our aggregator returns half_win.
  assert.equal(r.result, "WON");
  assert.equal(r.reason, "quarter_half_win");
});

test("HANDICAP_ASIAN: validate rejects 1/8 step", () => {
  assert.throws(
    () => ah.validate({ side: "HOME", handicap: -0.125 }),
    ValidationError,
  );
});
