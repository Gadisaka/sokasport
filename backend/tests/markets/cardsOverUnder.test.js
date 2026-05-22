import { test } from "node:test";
import assert from "node:assert/strict";
import cou from "../../services/markets/cardsOverUnder.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (stats) => ({
  finality: "FINAL",
  scores: { fullTime: { home: 0, away: 0 }, halfTime: { home: null, away: null } },
  stats,
  events: [],
});

test("CARDS_OVER_UNDER (CARDS scale): Over 3.5 when total is 5 → WON", () => {
  const stats = {
    cards: {
      home: { yellow: 2, red: 0 },
      away: { yellow: 3, red: 0 },
    },
    corners: { home: 0, away: 0 },
  };
  assert.equal(
    cou.evaluate(
      { market_params: { side: "OVER", line: 3.5, scale: "CARDS" } },
      mr(stats),
    ).result,
    "WON",
  );
});

test("CARDS_OVER_UNDER (POINTS scale): Under 25.5 with 2Y+1R+3Y = 5+2=7 pts → WON (regression)", () => {
  const stats = {
    cards: {
      home: { yellow: 2, red: 1 },
      away: { yellow: 3, red: 0 },
    },
    corners: { home: 0, away: 0 },
  };
  assert.equal(
    cou.evaluate(
      { market_params: { side: "UNDER", line: 25.5, scale: "POINTS" } },
      mr(stats),
    ).result,
    "WON",
  );
});

test("CARDS_OVER_UNDER: push on integer line → VOID", () => {
  const stats = {
    cards: { home: { yellow: 2, red: 0 }, away: { yellow: 2, red: 0 } },
    corners: { home: 0, away: 0 },
  };
  assert.equal(
    cou.evaluate({ market_params: { side: "OVER", line: 4 } }, mr(stats)).result,
    "VOID",
  );
});

test("CARDS_OVER_UNDER: validate rejects invalid scale", () => {
  assert.throws(
    () => cou.validate({ side: "OVER", line: 3.5, scale: "WEIRD" }),
    ValidationError,
  );
});
