import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  getOddsTolerance,
  oddsWithinTolerance,
} from "../services/odds-engine/tolerance.js";
import { normalizePlacementSelections } from "../services/odds-engine/normalize.js";
import { compareOddsDrift } from "../services/odds-engine/compareOdds.js";

test("getOddsTolerance defaults for channel and leg count", () => {
  assert.equal(getOddsTolerance({ live: true }), 0);
  assert.equal(getOddsTolerance({ live: false, selectionsCount: 1 }), 0.05);
  assert.equal(getOddsTolerance({ live: false, selectionsCount: 3 }), 0.02);
});

test("oddsWithinTolerance handles small drift and larger drift", () => {
  assert.equal(oddsWithinTolerance(1.9, 1.91, 0.02), true);
  assert.equal(oddsWithinTolerance(1.9, 1.95, 0.02), false);
});

test("normalizePlacementSelections keeps only valid betting legs", () => {
  const normalized = normalizePlacementSelections([
    {
      apiFixtureId: "100",
      marketLabel: "Match Winner",
      label: "Home",
      odds: 1.8,
    },
    {
      apiFixtureId: "bad",
      marketLabel: "Match Winner",
      label: "Away",
      odds: 2.1,
    },
    { apiFixtureId: "101", marketLabel: "Match Winner", label: "", odds: 2.1 },
    {
      apiFixtureId: "102",
      marketLabel: "Match Winner",
      label: "Draw",
      odds: 1,
    },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].apiFixtureId, 100);
});

test("compareOddsDrift returns changed odds payload", () => {
  const drift = compareOddsDrift({
    selections: [
      {
        index: 0,
        submittedOdds: 1.8,
        marketLabel: "Match Winner",
        label: "Home",
      },
      {
        index: 1,
        submittedOdds: 2.1,
        marketLabel: "Match Winner",
        label: "Away",
      },
    ],
    resolved: [
      { index: 0, serverOdds: 1.81, marketState: "OPEN" },
      { index: 1, serverOdds: 2.25, marketState: "OPEN" },
    ],
    tolerance: 0.02,
  });
  assert.equal(drift.oddsChanges.length, 1);
  assert.equal(drift.oddsChanges[0].index, 1);
  assert.equal(drift.oddsChanges[0].serverOdds, 2.25);
});

test("compareOddsDrift returns version mismatch even on equal odds", () => {
  const drift = compareOddsDrift({
    selections: [
      {
        index: 0,
        submittedOdds: 1.8,
        submittedMarketVersion: 3,
        marketLabel: "Match Winner",
        label: "Home",
      },
    ],
    resolved: [
      {
        index: 0,
        serverOdds: 1.8,
        serverMarketVersion: 4,
        marketState: "OPEN",
      },
    ],
    tolerance: 0.02,
  });
  assert.equal(drift.oddsChanges.length, 0);
  assert.equal(drift.versionChanges.length, 1);
  assert.equal(drift.versionChanges[0].serverMarketVersion, 4);
});

test("compareOddsDrift reports server odds AND version on every drift row", () => {
  // Accepting a leg must be possible in one round trip. If a version-drift row
  // omitted serverOdds (or an odds-drift row omitted serverMarketVersion), the
  // client would re-submit the stale one and bounce between the two codes.
  const drift = compareOddsDrift({
    selections: [
      {
        index: 0,
        submittedOdds: 1.8,
        submittedMarketVersion: 3,
        marketLabel: "Match Winner",
        label: "Home",
      },
      {
        index: 1,
        submittedOdds: 2.1,
        submittedMarketVersion: 7,
        marketLabel: "Match Winner",
        label: "Away",
      },
    ],
    resolved: [
      {
        index: 0,
        serverOdds: 1.95,
        serverMarketVersion: 4,
        marketState: "OPEN",
      },
      {
        index: 1,
        serverOdds: 2.5,
        serverMarketVersion: 7,
        marketState: "OPEN",
      },
    ],
    tolerance: 0.02,
  });

  const versionRow = drift.versionChanges.find((row) => row.index === 0);
  assert.equal(versionRow.serverOdds, 1.95);
  assert.equal(versionRow.serverMarketVersion, 4);

  const oddsRow = drift.oddsChanges.find((row) => row.index === 1);
  assert.equal(oddsRow.serverOdds, 2.5);
  assert.equal(oddsRow.serverMarketVersion, 7);
});

test("compareOddsDrift leaves version null when no version was submitted", () => {
  const drift = compareOddsDrift({
    selections: [
      {
        index: 0,
        submittedOdds: 1.8,
        marketLabel: "Match Winner",
        label: "Home",
      },
    ],
    resolved: [{ index: 0, serverOdds: 2.4, marketState: "OPEN" }],
    tolerance: 0.02,
  });

  assert.equal(drift.versionChanges.length, 0);
  assert.equal(drift.oddsChanges.length, 1);
  assert.equal(drift.oddsChanges[0].submittedMarketVersion, null);
  assert.equal(drift.oddsChanges[0].serverMarketVersion, null);
});

test("placement controller does not depend on upstream odds HTTP client", async () => {
  const content = await readFile(
    new URL("../controllers/ticketsController.js", import.meta.url),
    "utf8",
  );
  assert.equal(content.includes("apiSportsService"), false);
  assert.equal(content.includes("getLiveOdds("), false);
  assert.equal(content.includes("api("), false);
});
