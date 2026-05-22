import { test } from "node:test";
import assert from "node:assert/strict";
import ps from "../../services/markets/playerShots.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (players) => ({
  finality: "FINAL",
  scores: { fullTime: { home: 0, away: 0 }, halfTime: { home: null, away: null } },
  stats: { players },
  events: [],
});

test("PLAYER_SHOTS (ON_TARGET): Over 1.5 when player has 3 → WON", () => {
  assert.equal(
    ps.evaluate(
      {
        market_params: {
          playerId: "p-1",
          side: "OVER",
          line: 1.5,
          scope: "ON_TARGET",
        },
      },
      mr({ "p-1": { shotsOnTarget: 3, shotsTotal: 5 } }),
    ).result,
    "WON",
  );
});

test("PLAYER_SHOTS (TOTAL): push on integer line → VOID", () => {
  assert.equal(
    ps.evaluate(
      {
        market_params: {
          playerId: "p-1",
          side: "OVER",
          line: 5,
          scope: "TOTAL",
        },
      },
      mr({ "p-1": { shotsOnTarget: 3, shotsTotal: 5 } }),
    ).result,
    "VOID",
  );
});

test("PLAYER_SHOTS: canEvaluate false without players payload", () => {
  assert.equal(ps.canEvaluate({ stats: {} }), false);
});

test("PLAYER_SHOTS: validate rejects missing scope via invalid value", () => {
  assert.throws(
    () => ps.validate({ playerId: "p-1", side: "OVER", line: 1.5, scope: "WEIRD" }),
    ValidationError,
  );
});
