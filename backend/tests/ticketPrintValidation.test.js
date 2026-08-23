/**
 * Print-validation snapshot normalization (accepted odds / market version).
 * Run: node --test backend/tests/ticketPrintValidation.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSnapshotForPrintValidation } from "../services/ticketPrintValidation.js";

const SNAPSHOT = [
  {
    apiFixtureId: 101,
    marketLabel: "Match Winner",
    marketCode: "1X2",
    marketParams: null,
    label: "1",
    odds: 1.8,
    serverMarketVersion: 4242,
    marketVersion: null,
  },
];

test("acceptedMarketVersion null does not override snapshot serverMarketVersion", () => {
  const { normalized } = normalizeSnapshotForPrintValidation(SNAPSHOT, {
    selections: [
      {
        index: 0,
        acceptedOdds: 1.9,
        acceptedMarketVersion: null,
      },
    ],
  });
  assert.equal(normalized[0].odds, 1.9);
  assert.equal(normalized[0].marketVersion, 4242);
});

test("acceptedMarketVersion 0 does not override snapshot serverMarketVersion", () => {
  const { normalized } = normalizeSnapshotForPrintValidation(SNAPSHOT, {
    selections: [
      {
        index: 0,
        acceptedOdds: 1.9,
        acceptedMarketVersion: 0,
      },
    ],
  });
  assert.equal(normalized[0].marketVersion, 4242);
});

test("omitted acceptedMarketVersion keeps snapshot serverMarketVersion", () => {
  const { normalized } = normalizeSnapshotForPrintValidation(SNAPSHOT, {
    selections: [{ index: 0, acceptedOdds: 2.05 }],
  });
  assert.equal(normalized[0].odds, 2.05);
  assert.equal(normalized[0].marketVersion, 4242);
});

test("positive acceptedMarketVersion is applied", () => {
  const { normalized } = normalizeSnapshotForPrintValidation(SNAPSHOT, {
    selections: [
      {
        index: 0,
        acceptedOdds: 1.9,
        acceptedMarketVersion: 9999,
      },
    ],
  });
  assert.equal(normalized[0].marketVersion, 9999);
});

test("accepted odds replace snapshot odds", () => {
  const { normalized } = normalizeSnapshotForPrintValidation(SNAPSHOT, {
    selections: [{ index: 0, acceptedOdds: 2.4 }],
  });
  assert.equal(normalized[0].odds, 2.4);
});

test("no request selections keeps snapshot odds and version", () => {
  const { normalized } = normalizeSnapshotForPrintValidation(SNAPSHOT, {});
  assert.equal(normalized[0].odds, 1.8);
  assert.equal(normalized[0].marketVersion, 4242);
});
