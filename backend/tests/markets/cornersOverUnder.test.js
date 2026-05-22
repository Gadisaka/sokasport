import { test } from "node:test";
import assert from "node:assert/strict";
import cou from "../../services/markets/cornersOverUnder.js";

const mr = (homeC, awayC) => ({
  finality: "FINAL",
  scores: { fullTime: { home: 0, away: 0 }, halfTime: { home: null, away: null } },
  stats: {
    cards: { home: { yellow: 0, red: 0 }, away: { yellow: 0, red: 0 } },
    corners: { home: homeC, away: awayC },
  },
  events: [],
});

test("CORNERS_OVER_UNDER: Over 9.5 when total 10 → WON", () => {
  assert.equal(
    cou.evaluate(
      { market_params: { side: "OVER", line: 9.5 } },
      mr(6, 4),
    ).result,
    "WON",
  );
});

test("CORNERS_OVER_UNDER: push on integer line → VOID", () => {
  assert.equal(
    cou.evaluate(
      { market_params: { side: "OVER", line: 10 } },
      mr(6, 4),
    ).result,
    "VOID",
  );
});
