import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveFixtureScores } from "../jobs/lib/fixtureScores.js";

test("terminal AET: prefers score.fulltime (90') over ET-inclusive goals", () => {
  const entry = {
    goals: { home: 2, away: 1 }, // ET-inclusive total
    score: {
      fulltime: { home: 1, away: 1 }, // 90' regulation
      extratime: { home: 2, away: 1 },
      penalty: { home: null, away: null },
    },
  };
  const r = resolveFixtureScores(entry, { preferFullTime: true });
  assert.equal(r.homeScore, 1);
  assert.equal(r.awayScore, 1);
  assert.equal(r.etHome, 2);
  assert.equal(r.etAway, 1);
});

test("terminal PEN: exposes shootout score in pen fields, FT score stays 90'", () => {
  const entry = {
    goals: { home: 1, away: 1 },
    score: {
      fulltime: { home: 1, away: 1 },
      extratime: { home: 1, away: 1 },
      penalty: { home: 4, away: 3 },
    },
  };
  const r = resolveFixtureScores(entry, { preferFullTime: true });
  assert.equal(r.homeScore, 1);
  assert.equal(r.awayScore, 1);
  assert.equal(r.penHome, 4);
  assert.equal(r.penAway, 3);
});

test("live (preferFullTime false): keeps running goals score", () => {
  const entry = {
    goals: { home: 2, away: 1 },
    score: { fulltime: { home: 1, away: 1 } },
  };
  const r = resolveFixtureScores(entry, { preferFullTime: false });
  assert.equal(r.homeScore, 2);
  assert.equal(r.awayScore, 1);
});

test("terminal but score.fulltime absent: falls back to goals", () => {
  const entry = { goals: { home: 3, away: 0 }, score: {} };
  const r = resolveFixtureScores(entry, { preferFullTime: true });
  assert.equal(r.homeScore, 3);
  assert.equal(r.awayScore, 0);
});

test("0-0 regulation score is preserved (not treated as missing)", () => {
  const entry = {
    goals: { home: 1, away: 0 },
    score: { fulltime: { home: 0, away: 0 } },
  };
  const r = resolveFixtureScores(entry, { preferFullTime: true });
  assert.equal(r.homeScore, 0);
  assert.equal(r.awayScore, 0);
});

test("missing scores → nulls, no throw", () => {
  const r = resolveFixtureScores({}, { preferFullTime: true });
  assert.equal(r.homeScore, null);
  assert.equal(r.awayScore, null);
  assert.equal(r.etHome, null);
  assert.equal(r.penHome, null);
});
