import { test } from "node:test";
import assert from "node:assert/strict";
import fg from "../../services/markets/firstGoalscorer.js";
import { ValidationError } from "../../services/markets/errors.js";

const goal = (id, scorerId, minute, flags = {}) => ({
  id,
  type: "GOAL",
  minute,
  team: "HOME",
  scorer: { id: scorerId },
  flags,
});

const mr = (events, h = 2, a = 1) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events,
});

test("FIRST_GOALSCORER: first minute scorer matches → WON", () => {
  const events = [goal("a", "p-9", 10), goal("b", "p-8", 50)];
  assert.equal(
    fg.evaluate({ market_params: { playerId: "p-9" } }, mr(events)).result,
    "WON",
  );
});

test("FIRST_GOALSCORER: first goal was an own-goal → second becomes first (regression)", () => {
  const events = [
    goal("a", "p-9", 10, { ownGoal: true }),
    goal("b", "p-8", 50),
  ];
  assert.equal(
    fg.evaluate({ market_params: { playerId: "p-8" } }, mr(events)).result,
    "WON",
  );
  assert.equal(
    fg.evaluate({ market_params: { playerId: "p-9" } }, mr(events)).result,
    "LOST",
  );
});

test("FIRST_GOALSCORER: 0-0 match → every pick LOSES (no goalscorer branch)", () => {
  assert.equal(
    fg.evaluate({ market_params: { playerId: "p-9" } }, mr([], 0, 0)).result,
    "LOST",
  );
});

test("FIRST_GOALSCORER: validate rejects missing playerId", () => {
  assert.throws(() => fg.validate({}), ValidationError);
});
