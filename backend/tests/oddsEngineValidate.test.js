import test from "node:test";
import assert from "node:assert/strict";

import { validatePlacementSelections } from "../services/odds-engine/validateSelections.js";

function makePrisma({ fixtures = [], oddLines = [] }) {
  // Synthetic market ids so resolveOdds can join fixtureMarket → oddLines.
  const marketsByKey = new Map();
  for (const row of oddLines) {
    const key = `${row.fixtureId}::${row.marketName}`;
    if (!marketsByKey.has(key)) {
      marketsByKey.set(key, {
        id: `mkt-${marketsByKey.size + 1}`,
        name: row.marketName,
        fixture_id: row.fixtureId,
      });
    }
  }
  const marketIdByKey = new Map(
    [...marketsByKey.entries()].map(([k, m]) => [k, m.id]),
  );

  return {
    fixture: {
      findMany: async ({ where }) => {
        const ids = where?.api_fixture_id?.in || [];
        return fixtures.filter((f) => ids.includes(f.api_fixture_id));
      },
    },
    fixtureMarket: {
      findMany: async ({ where }) => {
        const fixtureId = where?.fixture_id;
        const names = where?.name?.in || [];
        return [...marketsByKey.values()].filter(
          (m) =>
            m.fixture_id === fixtureId &&
            (names.length === 0 || names.includes(m.name)),
        );
      },
    },
    fixtureOddLine: {
      findMany: async ({ where }) => {
        const marketIds = where?.market_id?.in || [];
        const valueFilter = where?.value;
        const values = Array.isArray(valueFilter?.in)
          ? valueFilter.in
          : [valueFilter].filter(Boolean);
        // Legacy path (market.fixture_id.in) kept for older assertions.
        const fixtureIds = where?.market?.fixture_id?.in || [];
        return oddLines
          .filter((row) => {
            const key = `${row.fixtureId}::${row.marketName}`;
            const marketId = marketIdByKey.get(key);
            const byMarket =
              marketIds.length === 0 || marketIds.includes(marketId);
            const byFixture =
              fixtureIds.length === 0 || fixtureIds.includes(row.fixtureId);
            const byValue =
              values.length === 0 || values.includes(row.value);
            return byMarket && byFixture && byValue;
          })
          .map((row) => ({
            odd: row.odd,
            value: row.value,
            market: { name: row.marketName, fixture_id: row.fixtureId },
            bookmaker: row.bookmaker || null,
          }));
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

test("validatePlacementSelections does NOT gate on version drift when submitted version is 0 (no-version sentinel)", async () => {
  // Compact six-cell strip selections carry no market version, so the client
  // submits 0. The server computes a real (non-zero) version hash. This must
  // NOT trip market_version_changed — odds drift is the only relevant gate.
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
        marketName: "Double Chance",
        value: "Draw/Away",
        odd: 1.5,
        bookmaker: { api_bookmaker_id: 8 },
      },
    ],
  });

  const out = await validatePlacementSelections({
    prismaClient: prisma,
    rawSelections: [
      {
        apiFixtureId: 11,
        marketLabel: "Double Chance",
        marketCode: "DOUBLE_CHANCE",
        marketParams: { combination: "X2" },
        label: "X2",
        odds: 1.5, // matches server odd, so no odds drift either
        marketVersion: 0,
      },
    ],
    live: false,
  });

  assert.equal(out.code, "ok");
  assert.equal(out.ok, true);
  assert.equal((out.versionDrift || []).length, 0);
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

test("validatePlacementSelections resolves DOUBLE_CHANCE compact labels (1X/12/X2) against stored Home/Draw values", async () => {
  const cases = [
    { label: "1X", value: "Home/Draw", odd: 1.3 },
    { label: "12", value: "Home/Away", odd: 1.25 },
    { label: "X2", value: "Draw/Away", odd: 1.45 },
  ];

  for (const { label, value, odd } of cases) {
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
          marketName: "Double Chance",
          value,
          odd,
          bookmaker: { api_bookmaker_id: 8 },
        },
      ],
    });

    const out = await validatePlacementSelections({
      prismaClient: prisma,
      rawSelections: [
        {
          apiFixtureId: 11,
          marketLabel: "Double Chance",
          label,
          odds: odd,
        },
      ],
      live: false,
    });

    assert.equal(out.ok, true, `${label} should resolve (got code=${out.code})`);
    assert.equal(out.code, "ok", `${label} expected ok`);
  }
});

test("validatePlacementSelections resolves DOUBLE_CHANCE via marketCode + combination params", async () => {
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
        marketName: "Double Chance",
        value: "Draw/Away",
        odd: 1.5,
        bookmaker: { api_bookmaker_id: 8 },
      },
    ],
  });

  const out = await validatePlacementSelections({
    prismaClient: prisma,
    rawSelections: [
      {
        apiFixtureId: 11,
        marketLabel: "Double Chance",
        marketCode: "DOUBLE_CHANCE",
        marketParams: { combination: "X2" },
        label: "X2",
        odds: 1.5,
      },
    ],
    live: false,
  });

  assert.equal(out.ok, true);
  assert.equal(out.code, "ok");
});

test("validatePlacementSelections resolves DC combo labels uppercased by UI against stored values", async () => {
  const prev = process.env.MARKET_ALLOWLIST_PHASE;
  process.env.MARKET_ALLOWLIST_PHASE = "score";
  try {
    const cases = [
      {
        marketLabel: "Double Chance/Both Teams To Score",
        label: "HOME/DRAW/YES",
        value: "Home/Draw/Yes",
        odd: 2.4,
      },
      {
        marketLabel: "Double Chance/Both Teams To Score",
        label: "1X/YES",
        value: "Home/Draw/Yes",
        odd: 2.4,
      },
      {
        marketLabel: "Double Chance/Total",
        label: "HOME/DRAW/OVER 2.5",
        value: "Home/Draw/Over 2.5",
        odd: 3.1,
      },
      {
        marketLabel: "Double Chance/Total",
        label: "1X AND OVER 2.5",
        value: "Home/Draw and Over 2.5",
        odd: 3.2,
      },
    ];

    for (const { marketLabel, label, value, odd } of cases) {
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
            marketName: marketLabel,
            value,
            odd,
            bookmaker: { api_bookmaker_id: 8 },
          },
        ],
      });

      const out = await validatePlacementSelections({
        prismaClient: prisma,
        rawSelections: [
          {
            apiFixtureId: 11,
            marketLabel,
            label,
            odds: odd,
          },
        ],
        live: false,
      });

      assert.equal(
        out.ok,
        true,
        `${marketLabel} ${label} → ${value} (code=${out.code} reason=${out.reason || ""})`,
      );
      assert.equal(out.code, "ok", `${marketLabel} ${label}`);
    }
  } finally {
    if (prev === undefined) delete process.env.MARKET_ALLOWLIST_PHASE;
    else process.env.MARKET_ALLOWLIST_PHASE = prev;
  }
});
