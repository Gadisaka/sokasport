import { test } from "node:test";
import assert from "node:assert/strict";
import tt from "../../services/markets/teamTotal.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (h, a) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
});

test("TEAM_TOTAL: HOME Over 1.5 on 2-0 → WON", () => {
  assert.equal(
    tt.evaluate(
      { market_params: { team: "HOME", side: "OVER", line: 1.5 } },
      mr(2, 0),
    ).result,
    "WON",
  );
});

test("TEAM_TOTAL: AWAY Under 0.5 on 2-0 → WON (regression: away blank)", () => {
  assert.equal(
    tt.evaluate(
      { market_params: { team: "AWAY", side: "UNDER", line: 0.5 } },
      mr(2, 0),
    ).result,
    "WON",
  );
});

test("TEAM_TOTAL: push on integer line HOME 2 line 2 → VOID", () => {
  assert.equal(
    tt.evaluate(
      { market_params: { team: "HOME", side: "OVER", line: 2 } },
      mr(2, 0),
    ).result,
    "VOID",
  );
});

test("TEAM_TOTAL: validate rejects missing team", () => {
  assert.throws(
    () => tt.validate({ side: "OVER", line: 1.5 }),
    ValidationError,
  );
});
