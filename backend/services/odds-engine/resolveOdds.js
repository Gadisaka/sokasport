import { resolveMarketState } from "./marketState.js";
import { buildPrematchMarketVersion } from "./versioning.js";

function kickoffInPast(startTime, now = new Date()) {
  if (!startTime) return false;
  const ts = new Date(startTime).getTime();
  if (Number.isNaN(ts)) return false;
  return ts <= now.getTime();
}

const MATCH_WINNER_MARKET_NAMES = [
  "Match Winner",
  "1X2",
  "Full Time Result",
  "Fulltime Result",
  "Match Result",
];

export function buildSelectionCandidates({
  selectionLabel,
  marketCode,
  marketParams,
}) {
  const raw = String(selectionLabel || "").trim();
  if (!raw) return [];
  const candidates = new Set([raw]);
  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();
  const cap = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  candidates.add(upper);
  candidates.add(lower);
  candidates.add(cap);

  // Unconditionally treat the short 1/X/2 tokens as winner aliases.
  if (upper === "1") {
    candidates.add("Home");
    candidates.add("HOME");
  }
  if (upper === "X") {
    candidates.add("Draw");
    candidates.add("DRAW");
  }
  if (upper === "2") {
    candidates.add("Away");
    candidates.add("AWAY");
  }
  if (upper === "HOME") candidates.add("1");
  if (upper === "DRAW") candidates.add("X");
  if (upper === "AWAY") candidates.add("2");

  const code = String(marketCode || "").toUpperCase().trim();
  const side = String(marketParams?.side || "").toUpperCase().trim();
  if (code === "MATCH_WINNER" && side) {
    if (side === "HOME") {
      candidates.add("Home");
      candidates.add("1");
    }
    if (side === "DRAW") {
      candidates.add("Draw");
      candidates.add("X");
    }
    if (side === "AWAY") {
      candidates.add("Away");
      candidates.add("2");
    }
  }

  return [...candidates].filter(Boolean);
}

export function buildMarketNameCandidates({ marketLabel, marketCode }) {
  const names = new Set();
  const label = String(marketLabel || "").trim();
  if (label) names.add(label);
  const code = String(marketCode || "").toUpperCase().trim();
  if (
    code === "MATCH_WINNER" ||
    label.toLowerCase().includes("match") ||
    label === "1X2" ||
    label.toLowerCase() === "match result"
  ) {
    for (const n of MATCH_WINNER_MARKET_NAMES) names.add(n);
  }
  return [...names].filter(Boolean);
}

async function findOddLine({
  prismaClient,
  fixtureId,
  marketLabel,
  selectionLabel,
  marketCode,
  marketParams,
}) {
  if (!selectionLabel) return null;
  const valuesIn = buildSelectionCandidates({
    selectionLabel,
    marketCode,
    marketParams,
  });
  const marketNames = buildMarketNameCandidates({ marketLabel, marketCode });

  if (marketNames.length > 0) {
    const exactByLabel = await prismaClient.fixtureOddLine.findFirst({
      where: {
        value: { in: valuesIn },
        market: {
          fixture_id: fixtureId,
          name: { in: marketNames },
        },
      },
      orderBy: { odd: "desc" },
      select: {
        odd: true,
        market: { select: { name: true } },
        bookmaker: { select: { api_bookmaker_id: true } },
      },
    });
    if (exactByLabel) return exactByLabel;
  }

  // Fallback: resolve odd line against the fixture by selection candidates
  // only. This intentionally accepts any market in DB that happens to
  // expose a matching value (rare, but safe — we still capture the real
  // server-side odd to compare against the client-submitted odd).
  const fallback = await prismaClient.fixtureOddLine.findFirst({
    where: {
      value: { in: valuesIn },
      market: { fixture_id: fixtureId },
    },
    orderBy: { odd: "desc" },
    select: {
      odd: true,
      market: { select: { name: true } },
      bookmaker: { select: { api_bookmaker_id: true } },
    },
  });
  if (fallback) return fallback;

  if (process.env.ODDS_ENGINE_DEBUG === "true") {
    console.warn("[oddsEngine] no odd line found", {
      fixtureId,
      marketLabel,
      marketCode,
      selectionLabel,
      candidates: valuesIn,
      marketNames,
    });
  }
  return null;
}

export async function resolvePrematchOdds({
  prismaClient,
  selections = [],
  now = new Date(),
}) {
  const fixtureIds = [
    ...new Set(selections.map((s) => s.apiFixtureId).filter(Boolean)),
  ];
  const fixtures = await prismaClient.fixture.findMany({
    where: { api_fixture_id: { in: fixtureIds } },
    select: {
      id: true,
      api_fixture_id: true,
      status: true,
      start_time: true,
    },
  });
  const fixtureByApiId = new Map(fixtures.map((f) => [f.api_fixture_id, f]));
  const resolved = [];
  for (const sel of selections) {
    const fixture = fixtureByApiId.get(sel.apiFixtureId);
    if (!fixture) {
      resolved.push({
        index: sel.index,
        code: "unknown_fixture",
      });
      continue;
    }
    const oddLine = await findOddLine({
      prismaClient,
      fixtureId: fixture.id,
      marketLabel: sel.marketLabel,
      selectionLabel: sel.label,
      marketCode: sel.marketCode,
      marketParams: sel.marketParams,
    });
    const rawOdd = Number(oddLine?.odd);
    const hasValidOdd = Number.isFinite(rawOdd) && rawOdd > 1;
    const marketState = resolveMarketState({
      fixtureStatus: fixture.status,
      hasOddLine: hasValidOdd,
    });
    resolved.push({
      index: sel.index,
      fixtureId: fixture.id,
      apiFixtureId: fixture.api_fixture_id,
      fixtureStatus: fixture.status,
      kickoffAt: fixture.start_time,
      started: kickoffInPast(fixture.start_time, now),
      marketState,
      serverOdds: hasValidOdd ? rawOdd : NaN,
      bookmakerApiId: oddLine?.bookmaker?.api_bookmaker_id ?? null,
      serverMarketVersion: hasValidOdd
        ? buildPrematchMarketVersion({
            fixtureId: fixture.api_fixture_id,
            marketLabel: sel.marketLabel,
            selectionLabel: sel.label,
            odd: rawOdd,
            bookmakerApiId: oddLine?.bookmaker?.api_bookmaker_id,
          })
        : null,
      serverUpdatedAt: fixture.start_time,
    });
  }
  return resolved;
}
