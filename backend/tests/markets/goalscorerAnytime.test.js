import { test } from "node:test";
import assert from "node:assert/strict";
import gs from "../../services/markets/goalscorerAnytime.js";
import { ValidationError } from "../../services/markets/errors.js";

const goalEvent = (scorerId, flags = {}) => ({
  type: "GOAL",
  minute: 50,
  team: "HOME",
  scorer: { id: scorerId },
  flags,
});

const mr = (events) => ({
  finality: "FINAL",
  scores: { fullTime: { home: 2, away: 1 }, halfTime: { home: null, away: null } },
  stats: {},
  events,
});

test("GOALSCORER_ANYTIME: player scored → WON", () => {
  const r = gs.evaluate(
    { market_params: { playerId: "p-9" } },
    mr([goalEvent("p-9")]),
  );
  assert.equal(r.result, "WON");
});

test("GOALSCORER_ANYTIME: own-goal by player does not count → LOST (regression)", () => {
  const r = gs.evaluate(
    { market_params: { playerId: "p-9" } },
    mr([goalEvent("p-9", { ownGoal: true })]),
  );
  assert.equal(r.result, "LOST");
});

test("GOALSCORER_ANYTIME: VAR-overturned goal does not count → LOST", () => {
  const r = gs.evaluate(
    { market_params: { playerId: "p-9" } },
    mr([goalEvent("p-9", { varOverturned: true })]),
  );
  assert.equal(r.result, "LOST");
});

test("GOALSCORER_ANYTIME: no goals → LOST", () => {
  assert.equal(
    gs.evaluate({ market_params: { playerId: "p-9" } }, mr([])).result,
    "LOST",
  );
});

test("GOALSCORER_ANYTIME: validate rejects missing playerId", () => {
  assert.throws(() => gs.validate({}), ValidationError);
});

test("GOALSCORER_ANYTIME: canEvaluate false when events not array", () => {
  assert.equal(gs.canEvaluate({ events: null }), false);
});
