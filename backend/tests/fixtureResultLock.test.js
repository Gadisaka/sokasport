import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isFixtureResultLocked,
  buildFixtureSyncData,
  fixtureSyncUnchanged,
} from "../lib/fixtureResultLock.js";

describe("fixtureResultLock", () => {
  it("isFixtureResultLocked is false when unset", () => {
    assert.equal(isFixtureResultLocked({}), false);
    assert.equal(isFixtureResultLocked({ result_locked_at: null }), false);
  });

  it("isFixtureResultLocked is true when set", () => {
    assert.equal(
      isFixtureResultLocked({ result_locked_at: new Date() }),
      true,
    );
  });

  it("buildFixtureSyncData preserves scores when locked", () => {
    const existing = { result_locked_at: new Date(), status: "FT" };
    const incoming = {
      start_time: new Date("2026-05-21T15:00:00Z"),
      status: "LIVE",
      home_score: 9,
      away_score: 0,
      league_id: "l1",
      home_team_id: "h1",
      away_team_id: "a1",
    };
    const data = buildFixtureSyncData(existing, incoming);
    assert.equal(data.status, undefined);
    assert.equal(data.home_score, undefined);
    assert.equal(data.league_id, "l1");
  });

  it("fixtureSyncUnchanged ignores score drift when locked", () => {
    const t = new Date("2026-05-21T15:00:00Z");
    const existing = {
      result_locked_at: new Date(),
      status: "FT",
      home_score: 2,
      away_score: 1,
      league_id: "l1",
      home_team_id: "h1",
      away_team_id: "a1",
      start_time: t,
    };
    const incoming = {
      start_time: t,
      status: "LIVE",
      home_score: 0,
      away_score: 0,
      league_id: "l1",
      home_team_id: "h1",
      away_team_id: "a1",
    };
    assert.equal(fixtureSyncUnchanged(existing, incoming), true);
  });
});
