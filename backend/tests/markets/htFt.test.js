import { test } from "node:test";
import assert from "node:assert/strict";
import htFt from "../../services/markets/htFt.js";

const mr = (ftH, ftA, htH, htA) => ({
  finality: "FINAL",
  scores: {
    fullTime: { home: ftH, away: ftA },
    halfTime: { home: htH, away: htA },
  },
  stats: {},
  events: [],
});

test("HT_FT: HOME/HOME on HT 1-0, FT 2-0 → WON", () => {
  assert.equal(
    htFt.evaluate(
      { market_params: { ht: "HOME", ft: "HOME" } },
      mr(2, 0, 1, 0),
    ).result,
    "WON",
  );
});

test("HT_FT: DRAW/HOME on HT 0-0, FT 2-1 → WON (regression: classic come-back)", () => {
  assert.equal(
    htFt.evaluate(
      { market_params: { ht: "DRAW", ft: "HOME" } },
      mr(2, 1, 0, 0),
    ).result,
    "WON",
  );
});

test("HT_FT: HOME/HOME on HT 0-0 → LOST (HT mismatch)", () => {
  assert.equal(
    htFt.evaluate(
      { market_params: { ht: "HOME", ft: "HOME" } },
      mr(2, 0, 0, 0),
    ).result,
    "LOST",
  );
});
