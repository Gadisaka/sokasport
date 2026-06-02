import test from "node:test";
import assert from "node:assert/strict";

import { validatePlacementSelections } from "../services/odds-engine/validateSelections.js";

function makePrisma({ fixtures = [], oddLines = [] }) {
  return {
    fixture: {
      findMany: async ({ where }) => {
        const ids = where?.api_fixture_id?.in || [];
        return fixtures.filter((f) => ids.includes(f.api_fixture_id));
      },
    },
    fixtureOddLine: {
      findFirst: async ({ where }) => {
        const fixtureId = where?.market?.fixture_id;
        const marketName = where?.market?.name;
        const valueFilter = where?.value;
        const values = Array.isArray(valueFilter?.in)
          ? valueFilter.in
          : [valueFilter].filter(Boolean);
        return (
          oddLines.find(
            (row) =>
              row.fixtureId === fixtureId &&
              (!marketName || row.marketName === marketName) &&
              values.includes(row.value),
          ) || null
        );
      },
    },
  };
}

test("validatePlacementSelections returns odds_changed when drift exceeds tolerance", async () => {
  const prisma = makePrisma({
    fixtures: [
      {
        id: "fx1",
        api_fixture_id: 11,
        status: "NS",
        start_time: new Date(Date.now() + 60_000),
      },
    ],
    oddLines: [
      {
        fixtureId: "fx1",
        marketName: "Match Winner",
        value: "Home",
        odd: 1.7,
        bookmaker: { api_bookmaker_id: 8 },
      },
    ],
  });

  const out = await validatePlacementSelections({
    prismaClient: prisma,
    rawSelections: [
      {
        apiFixtureId: 11,
        marketLabel: "Match Winner",
        label: "Home",
        odds: 1.85,
      },
    ],
    live: false,
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "odds_changed");
  assert.equal(out.drift.length, 1);
});

test("validatePlacementSelections rejects pre-match fixture that already started", async () => {
  const prisma = makePrisma({
    fixtures: [
      {
        id: "fx1",
        api_fixture_id: 11,
        status: "NS",
        start_time: new Date(Date.now() - 60_000),
      },
    ],
    oddLines: [
      {
        fixtureId: "fx1",
        marketName: "Match Winner",
        value: "Home",
        odd: 1.8,
        bookmaker: { api_bookmaker_id: 8 },
      },
    ],
  });

  const out = await validatePlacementSelections({
    prismaClient: prisma,
    rawSelections: [
      {
        apiFixtureId: 11,
        marketLabel: "Match Winner",
        label: "Home",
        odds: 1.8,
      },
    ],
    live: false,
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "fixture_started");
});

test("validatePlacementSelections returns market_suspended when odd line missing", async () => {
  const prisma = makePrisma({
    fixtures: [
      {
        id: "fx1",
        api_fixture_id: 11,
        status: "NS",
        start_time: new Date(Date.now() + 60_000),
      },
    ],
    oddLines: [],
  });

  const out = await validatePlacementSelections({
    prismaClient: prisma,
    rawSelections: [
      {
        apiFixtureId: 11,
        marketLabel: "Match Winner",
        label: "Home",
        odds: 1.8,
      },
    ],
    live: false,
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "market_suspended");
});

test("validatePlacementSelections returns market_version_changed even when odds match", async () => {
  const prisma = makePrisma({
    fixtures: [
      {
        id: "fx1",
        api_fixture_id: 11,
        status: "NS",
        start_time: new Date(Date.now() + 60_000),
      },
    ],
    oddLines: [
      {
        fixtureId: "fx1",
        marketName: "Match Winner",
        value: "Home",
        odd: 1.8,
        bookmaker: { api_bookmaker_id: 8 },
      },
    ],
  });

  const out = await validatePlacementSelections({
    prismaClient: prisma,
    rawSelections: [
      {
        apiFixtureId: 11,
        marketLabel: "Match Winner",
        label: "Home",
        odds: 1.8,
        marketVersion: 1,
      },
    ],
    live: false,
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "market_version_changed");
  assert.equal(Array.isArray(out.versionDrift), true);
  assert.equal(out.versionDrift.length, 1);
});

test("validatePlacementSelections resolves MATCH_WINNER alias labels (1/X/2)", async () => {
  const prisma = makePrisma({
    fixtures: [
      {
        id: "fx1",
        api_fixture_id: 11,
        status: "NS",
        start_time: new Date(Date.now() + 60_000),
      },
    ],
    oddLines: [
      {
        fixtureId: "fx1",
        marketName: "Match Winner",
        value: "Home",
        odd: 4.5,
        bookmaker: { api_bookmaker_id: 8 },
      },
    ],
  });

  const out = await validatePlacementSelections({
    prismaClient: prisma,
    rawSelections: [
      {
        apiFixtureId: 11,
        marketLabel: "Match Winner",
        marketCode: "MATCH_WINNER",
        marketParams: { side: "HOME" },
        label: "1",
        odds: 4.5,
      },
    ],
    live: false,
  });

  assert.equal(out.ok, true);
  assert.equal(out.code, "ok");
});
