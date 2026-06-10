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

const DOUBLE_CHANCE_MARKET_NAMES = ["Double Chance"];

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

  // Double Chance: the UI/frontend submits the compact tokens 1X / 12 / X2,
  // but ingestion stores API-Sports value strings ("Home/Draw", "Home/Away",
  // "Draw/Away"). Bridge both directions so the resolver can match the stored
  // odd line. Without this, every Double Chance leg resolves to no odd line
  // and is wrongly reported as market_suspended.
  const DOUBLE_CHANCE_ALIASES = {
    "1X": ["Home/Draw", "HOME/DRAW", "Home or Draw"],
    "X1": ["Home/Draw", "HOME/DRAW", "Home or Draw"],
    "12": ["Home/Away", "HOME/AWAY", "Home or Away"],
    "21": ["Home/Away", "HOME/AWAY", "Home or Away"],
    "X2": ["Draw/Away", "DRAW/AWAY", "Draw or Away"],
    "2X": ["Draw/Away", "DRAW/AWAY", "Draw or Away"],
    "HOME/DRAW": ["1X"],
    "HOME/AWAY": ["12"],
    "DRAW/AWAY": ["X2"],
    "HOME OR DRAW": ["1X"],
    "HOME OR AWAY": ["12"],
    "DRAW OR AWAY": ["X2"],
  };
  const dcAliases = DOUBLE_CHANCE_ALIASES[upper];
  if (dcAliases) {
    for (const alias of dcAliases) candidates.add(alias);
  }

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

  // Double Chance carried via market params (combination) — settlement stores
  // the canonical "1X" | "12" | "X2", so expand those to the stored API-Sports
  // value strings as well.
  const combination = String(marketParams?.combination || "")
    .toUpperCase()
    .trim();
  if (code === "DOUBLE_CHANCE" && combination) {
    const comboAliases = DOUBLE_CHANCE_ALIASES[combination];
    if (comboAliases) {
      candidates.add(combination);
      for (const alias of comboAliases) candidates.add(alias);
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
  if (code === "DOUBLE_CHANCE" || label.toLowerCase().includes("double chance")) {
    for (const n of DOUBLE_CHANCE_MARKET_NAMES) names.add(n);
  }
  return [...names].filter(Boolean);
}

/**
 * Pick the best matching odd line for one selection from an in-memory set of
 * lines already scoped to that selection's fixture. Mirrors the previous
 * per-selection DB lookup exactly: prefer an exact market-name match (highest
 * odd), else fall back to any market exposing a matching value (highest odd).
 */
function pickOddLineForSelection(fixtureLines, { valuesIn, marketNames }) {
  if (!fixtureLines || fixtureLines.length === 0) return null;
  const valueSet = new Set(valuesIn);
  const valueMatches = fixtureLines.filter((line) => valueSet.has(line.value));
  if (valueMatches.length === 0) return null;

  // Equivalent to Prisma `orderBy: { odd: "desc" }` + `findFirst`.
  const highestOdd = (rows) =>
    rows.reduce(
      (best, row) =>
        best === null || Number(row.odd) > Number(best.odd) ? row : best,
      null,
    );

  if (marketNames.length > 0) {
    const nameSet = new Set(marketNames);
    const exact = highestOdd(
      valueMatches.filter((line) => nameSet.has(line.market?.name)),
    );
    if (exact) return exact;
  }

  // Fallback: any market in DB that happens to expose a matching value
  // (rare, but safe — we still capture the real server-side odd).
  return highestOdd(valueMatches);
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

  // Pre-compute each leg's candidate values/market names once, then resolve
  // every odd line for the whole slip in a SINGLE batched query instead of
  // 1-2 queries per leg (the old N+1). Lines are matched in memory per leg.
  const selectionMeta = selections.map((sel) => ({
    sel,
    valuesIn: buildSelectionCandidates({
      selectionLabel: sel.label,
      marketCode: sel.marketCode,
      marketParams: sel.marketParams,
    }),
    marketNames: buildMarketNameCandidates({
      marketLabel: sel.marketLabel,
      marketCode: sel.marketCode,
    }),
  }));

  const dbFixtureIds = [...new Set(fixtures.map((f) => f.id))];
  const allValues = [...new Set(selectionMeta.flatMap((m) => m.valuesIn))];

  let oddLines = [];
  if (dbFixtureIds.length > 0 && allValues.length > 0) {
    oddLines = await prismaClient.fixtureOddLine.findMany({
      where: {
        value: { in: allValues },
        market: { fixture_id: { in: dbFixtureIds } },
      },
      select: {
        odd: true,
        value: true,
        market: { select: { name: true, fixture_id: true } },
        bookmaker: { select: { api_bookmaker_id: true } },
      },
    });
  }

  const linesByFixtureId = new Map();
  for (const line of oddLines) {
    const fid = line.market?.fixture_id;
    if (!fid) continue;
    const bucket = linesByFixtureId.get(fid);
    if (bucket) bucket.push(line);
    else linesByFixtureId.set(fid, [line]);
  }

  const resolved = [];
  for (const meta of selectionMeta) {
    const sel = meta.sel;
    const fixture = fixtureByApiId.get(sel.apiFixtureId);
    if (!fixture) {
      resolved.push({
        index: sel.index,
        code: "unknown_fixture",
      });
      continue;
    }
    const oddLine = pickOddLineForSelection(linesByFixtureId.get(fixture.id), {
      valuesIn: meta.valuesIn,
      marketNames: meta.marketNames,
    });
    if (!oddLine && process.env.ODDS_ENGINE_DEBUG === "true") {
      console.warn("[oddsEngine] no odd line found", {
        fixtureId: fixture.id,
        marketLabel: sel.marketLabel,
        marketCode: sel.marketCode,
        selectionLabel: sel.label,
        candidates: meta.valuesIn,
        marketNames: meta.marketNames,
      });
    }
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
