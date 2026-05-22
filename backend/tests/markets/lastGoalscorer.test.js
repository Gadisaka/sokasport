import { test } from "node:test";
import assert from "node:assert/strict";
import lg from "../../services/markets/lastGoalscorer.js";

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

test("LAST_GOALSCORER: last minute scorer matches → WON", () => {
  const events = [goal("a", "p-9", 10), goal("b", "p-8", 85)];
  assert.equal(
    lg.evaluate({ market_params: { playerId: "p-8" } }, mr(events)).result,
    "WON",
  );
});

test("LAST_GOALSCORER: VAR-overturned last goal → previous is 'last' (regression)", () => {
  const events = [
    goal("a", "p-9", 10),
    goal("b", "p-8", 85, { varOverturned: true }),
  ];
  assert.equal(
    lg.evaluate({ market_params: { playerId: "p-9" } }, mr(events)).result,
    "WON",
  );
});

test("LAST_GOALSCORER: 0-0 → LOST", () => {
  assert.equal(
    lg.evaluate({ market_params: { playerId: "p-9" } }, mr([], 0, 0)).result,
    "LOST",
  );
});
