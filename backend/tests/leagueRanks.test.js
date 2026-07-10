import assert from "node:assert/strict";
import test from "node:test";
import {
  getLeagueRank,
  isTopLeague,
  pickTopActiveLeagues,
} from "../Config/leagueRanks.js";

test("getLeagueRank returns seeded rank for known leagues", () => {
  assert.equal(getLeagueRank(2), 1);
  assert.equal(getLeagueRank(39), 2);
  assert.equal(getLeagueRank(363), 9);
  assert.equal(getLeagueRank(1228), 10);
  assert.equal(getLeagueRank(999999), 9999);
});

test("product priority leagues are top leagues for sidebar", () => {
  assert.equal(isTopLeague(363), true);
  assert.equal(isTopLeague(1228), true);
});

test("world cup ranks above finland veikkausliiga", () => {
  assert.ok(getLeagueRank(1) < getLeagueRank(244));
});

test("isTopLeague identifies preferred / top threshold leagues", () => {
  assert.equal(isTopLeague(39), true);
  assert.equal(isTopLeague(848), true);
  assert.equal(isTopLeague(999999), false);
});

test("pickTopActiveLeagues sorts by rank and caps", () => {
  const picked = pickTopActiveLeagues([500, 39, 140, 999999], 2);
  assert.deepEqual([...picked], [39, 140]);
});

test("pickTopActiveLeagues returns empty set for zero cap", () => {
  assert.equal(pickTopActiveLeagues([39, 140], 0).size, 0);
});
