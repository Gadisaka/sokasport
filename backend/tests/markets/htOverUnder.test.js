import { test } from "node:test";
import assert from "node:assert/strict";
import hou from "../../services/markets/htOverUnder.js";

const mr = (hh, ha) => ({
  finality: "FINAL",
  scores: {
    fullTime: { home: 5, away: 5 },
    halfTime: { home: hh, away: ha },
  },
  stats: {},
  events: [],
});

test("HT_OVER_UNDER: Over 0.5 HT on 1-0 → WON", () => {
  assert.equal(
    hou.evaluate({ market_params: { side: "OVER", line: 0.5 } }, mr(1, 0)).result,
    "WON",
  );
});

test("HT_OVER_UNDER: Under 0.5 HT on 0-0 → WON (regression: nil-nil HT)", () => {
  assert.equal(
    hou.evaluate({ market_params: { side: "UNDER", line: 0.5 } }, mr(0, 0)).result,
    "WON",
  );
});

test("HT_OVER_UNDER: push on integer line HT 1-0 line 1 → VOID", () => {
  assert.equal(
    hou.evaluate({ market_params: { side: "OVER", line: 1 } }, mr(1, 0)).result,
    "VOID",
  );
});
