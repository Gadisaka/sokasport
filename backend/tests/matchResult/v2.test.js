import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMatchResultV2FromFixture,
  buildMatchResultV2FromMatch,
  deriveFinality,
  MATCH_RESULT_SCHEMA_VERSION,
  _internals,
} from "../../services/matchResult/v2.js";

test("deriveFinality: terminal statuses", () => {
  assert.equal(deriveFinality("FT"), "FINAL");
  assert.equal(deriveFinality("AET"), "FINAL");
  assert.equal(deriveFinality("PEN"), "FINAL");
  assert.equal(deriveFinality("AWD"), "AWARDED");
  assert.equal(deriveFinality("WO"), "AWARDED");
  assert.equal(deriveFinality("CANC"), "VOID");
  assert.equal(deriveFinality("ABD"), "VOID");
  assert.equal(deriveFinality("PST"), "VOID");
  assert.equal(deriveFinality("NS"), "PENDING");
  assert.equal(deriveFinality("LIVE"), "PENDING");
  assert.equal(deriveFinality(""), "PENDING");
  assert.equal(deriveFinality(null), "PENDING");
});

test("fixture FINAL with HT scores is normalized", () => {
  const mr = buildMatchResultV2FromFixture({
    id: "fx-1",
    api_fixture_id: 1001,
    status: "FT",
    home_score: 2,
    away_score: 1,
    ht_home_score: 1,
    ht_away_score: 0,
    settled_at: null,
    result_version: 3,
  });
  assert.equal(mr.schemaVersion, MATCH_RESULT_SCHEMA_VERSION);
  assert.equal(mr.source, "FIXTURE");
  assert.equal(mr.finality, "FINAL");
  assert.equal(mr.scores.fullTime.home, 2);
  assert.equal(mr.scores.halfTime.home, 1);
  assert.equal(mr.resultVersion, 3);
  assert.ok(typeof mr.hash === "string" && mr.hash.length === 64);
});

test("fixture AWARDED without scores keeps AWARDED", () => {
  const mr = buildMatchResultV2FromFixture({
    id: "fx-2",
    status: "AWD",
    home_score: null,
    away_score: null,
  });
  assert.equal(mr.finality, "AWARDED");
  assert.equal(mr.scores.fullTime.home, null);
});

test("cancelled fixture → VOID finality", () => {
  const mr = buildMatchResultV2FromFixture({
    id: "fx-3",
    status: "CANC",
    home_score: null,
    away_score: null,
  });
  assert.equal(mr.finality, "VOID");
});

test("inconsistent events (score does not match goal events) → downgraded to PENDING", () => {
  const mr = buildMatchResultV2FromFixture(
    {
      id: "fx-4",
      status: "FT",
      home_score: 2,
      away_score: 1,
    },
    {
      // Only one goal event — doesn't match 2-1.
      events: [
        {
          type: "GOAL",
          minute: 23,
          team: "HOME",
          scorer: { id: "p1", name: "Player" },
          flags: {},
        },
      ],
    },
  );
  assert.equal(mr.finality, "PENDING");
});

test("hash is stable under event reorder (sorted by minute, id)", () => {
  const base = {
    id: "fx-5",
    status: "FT",
    home_score: 1,
    away_score: 0,
  };
  const a = buildMatchResultV2FromFixture(base, {
    events: [
      { id: "b", type: "GOAL", minute: 34, team: "HOME", scorer: { id: "p1" }, flags: {} },
      { id: "a", type: "CARD", minute: 34, color: "YELLOW", team: "AWAY", player: { id: "p2" } },
    ],
  });
  const b = buildMatchResultV2FromFixture(base, {
    events: [
      { id: "a", type: "CARD", minute: 34, color: "YELLOW", team: "AWAY", player: { id: "p2" } },
      { id: "b", type: "GOAL", minute: 34, team: "HOME", scorer: { id: "p1" }, flags: {} },
    ],
  });
  assert.equal(a.hash, b.hash);
});

test("null fixture returns PENDING placeholder", () => {
  const mr = buildMatchResultV2FromFixture(null);
  assert.equal(mr.finality, "PENDING");
  assert.equal(mr.source, "FIXTURE");
});

test("admin match FINISHED with result label → FINAL, resultLabel preserved", () => {
  const mr = buildMatchResultV2FromMatch({
    id: "m-1",
    status: "FINISHED",
    result: "Home",
    settled_at: new Date("2026-05-04T21:00:00Z"),
  });
  assert.equal(mr.source, "MATCH");
  assert.equal(mr.finality, "FINAL");
  assert.equal(mr.resultLabel, "Home");
  assert.equal(mr.provider, "ADMIN");
});

test("admin match NOT_STARTED → PENDING", () => {
  const mr = buildMatchResultV2FromMatch({ id: "m-2", status: "NOT_STARTED" });
  assert.equal(mr.finality, "PENDING");
});

test("internals: canonicalStringify sorts keys", () => {
  const a = _internals.canonicalStringify({ b: 1, a: 2 });
  const b = _internals.canonicalStringify({ a: 2, b: 1 });
  assert.equal(a, b);
});
