import assert from "node:assert/strict";
import test from "node:test";
import { sortFixturesForOddsIngest, getLeagueTier } from "../Config/leagueTiers.js";

test("sortFixturesForOddsIngest orders lower tier before higher tier", () => {
  process.env.LEAGUE_TIERS_JSON = JSON.stringify({ 39: 0, 140: 5 });

  const nearEnd = null;
  const fixtures = [
    {
      id: "b",
      start_time: new Date("2030-01-02T12:00:00Z"),
      league: { api_league_id: 140 },
    },
    {
      id: "a",
      start_time: new Date("2030-01-03T12:00:00Z"),
      league: { api_league_id: 39 },
    },
  ];

  const sorted = sortFixturesForOddsIngest(fixtures, {
    nearPriorityEnd: nearEnd,
  });
  assert.equal(sorted[0].id, "a");
  assert.equal(sorted[1].id, "b");

  delete process.env.LEAGUE_TIERS_JSON;
});

test("getLeagueTier uses league rank when LEAGUE_TIERS_JSON is unset", () => {
  delete process.env.LEAGUE_TIERS_JSON;
  assert.ok(getLeagueTier(39) < getLeagueTier(999999));
});

test("sortFixturesForOddsIngest prefers kickoffs inside nearPriorityEnd bucket", () => {
  delete process.env.LEAGUE_TIERS_JSON;

  const nearEnd = new Date("2030-01-02T23:59:59Z");
  const fixtures = [
    {
      id: "far",
      start_time: new Date("2030-01-10T12:00:00Z"),
      league: { api_league_id: 39 },
    },
    {
      id: "near",
      start_time: new Date("2030-01-02T15:00:00Z"),
      league: { api_league_id: 39 },
    },
  ];

  const sorted = sortFixturesForOddsIngest(fixtures, { nearPriorityEnd: nearEnd });
  assert.equal(sorted[0].id, "near");
  assert.equal(sorted[1].id, "far");
});
