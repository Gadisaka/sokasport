import { test } from "node:test";
import assert from "node:assert/strict";
import eh from "../../services/markets/handicapEuropean.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (h, a) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
});

test("HANDICAP_EUROPEAN: HOME -2 applied to HOME on 2-0 → adjusted 0-0, DRAW pick wins", () => {
  assert.equal(
    eh.evaluate(
      { market_params: { side: "DRAW", handicap: -2, appliedTo: "HOME" } },
      mr(2, 0),
    ).result,
    "WON",
  );
});

test("HANDICAP_EUROPEAN: HOME -1 applied to HOME on 2-0 → adjusted 1-0, HOME pick wins", () => {
  assert.equal(
    eh.evaluate(
      { market_params: { side: "HOME", handicap: -1, appliedTo: "HOME" } },
      mr(2, 0),
    ).result,
    "WON",
  );
});

test("HANDICAP_EUROPEAN: HOME +1 applied to AWAY on 1-0 (away becomes 1) → HOME pick loses (draw)", () => {
  assert.equal(
    eh.evaluate(
      { market_params: { side: "HOME", handicap: 1, appliedTo: "AWAY" } },
      mr(1, 0),
    ).result,
    "LOST",
  );
});

test("HANDICAP_EUROPEAN: validate rejects non-integer handicap", () => {
  assert.throws(
    () => eh.validate({ side: "HOME", handicap: -0.5 }),
    ValidationError,
  );
});
