import { test } from "node:test";
import assert from "node:assert/strict";
import pc from "../../services/markets/playerCards.js";
import { ValidationError } from "../../services/markets/errors.js";

const cardEvent = (playerId, color) => ({
  type: "CARD",
  minute: 50,
  team: "HOME",
  color,
  player: { id: playerId },
});

const mr = (events) => ({
  finality: "FINAL",
  scores: { fullTime: { home: 0, away: 0 }, halfTime: { home: null, away: null } },
  stats: {},
  events,
});

test("PLAYER_CARDS: YELLOW_OR_RED and player received a yellow → WON", () => {
  assert.equal(
    pc.evaluate(
      { market_params: { playerId: "p-1", pick: "YELLOW_OR_RED" } },
      mr([cardEvent("p-1", "YELLOW")]),
    ).result,
    "WON",
  );
});

test("PLAYER_CARDS: RED pick and only yellow → LOST", () => {
  assert.equal(
    pc.evaluate(
      { market_params: { playerId: "p-1", pick: "RED" } },
      mr([cardEvent("p-1", "YELLOW")]),
    ).result,
    "LOST",
  );
});

test("PLAYER_CARDS: NONE pick and player not carded → WON (regression)", () => {
  assert.equal(
    pc.evaluate(
      { market_params: { playerId: "p-99", pick: "NONE" } },
      mr([cardEvent("p-1", "YELLOW")]),
    ).result,
    "WON",
  );
});

test("PLAYER_CARDS: SECOND_YELLOW counts as RED", () => {
  assert.equal(
    pc.evaluate(
      { market_params: { playerId: "p-1", pick: "RED" } },
      mr([cardEvent("p-1", "SECOND_YELLOW")]),
    ).result,
    "WON",
  );
});

test("PLAYER_CARDS: validate rejects missing playerId", () => {
  assert.throws(() => pc.validate({ pick: "YELLOW" }), ValidationError);
});
