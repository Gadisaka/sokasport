const FIXTURE_CLOSED_STATUSES = new Set([
  "FT",
  "AET",
  "PEN",
  "FINISHED",
  "CANC",
  "PST",
  "ABD",
  "AWD",
  "WO",
  "INT",
]);

export function normalizeFixtureStatus(status) {
  return String(status || "")
    .trim()
    .toUpperCase();
}

export function resolveMarketState({
  fixtureStatus,
  hasOddLine,
  operatorState = null,
}) {
  // Terminal fixture status wins over operator state: a finished match is
  // CLOSED even if an operator/provider flag still says SUSPENDED/LOCKED. This
  // keeps the helper consistent with the resolveLiveLegState precedence ladder
  // (#1 terminal > #3 operator state) for any direct caller.
  const normalizedStatus = normalizeFixtureStatus(fixtureStatus);
  if (FIXTURE_CLOSED_STATUSES.has(normalizedStatus)) {
    return "CLOSED";
  }
  const op = String(operatorState || "")
    .trim()
    .toUpperCase();
  if (op === "LOCKED" || op === "SUSPENDED" || op === "CLOSED") {
    return op;
  }
  if (!hasOddLine) {
    return "SUSPENDED";
  }
  return "OPEN";
}

// In-play fixture statuses, as stored after `syncLiveFixtures` STATUS_MAP
// (LIVE / HT / PEN) plus the raw API-Sports short codes as defensive cover
// in case an un-mapped status ever reaches the resolver.
const LIVE_FIXTURE_STATUSES = new Set([
  "LIVE",
  "HT",
  "PEN",
  "1H",
  "2H",
  "ET",
  "BT",
  "P",
]);

/**
 * Server-authoritative liveness check. The placement layer must NOT trust the
 * client `fromLive` flag — a leg is "live" only when the fixture is actually
 * in-play according to our own stored status.
 *
 * @param {string|null|undefined} status
 * @returns {boolean}
 */
export function isLiveFixtureStatus(status) {
  return LIVE_FIXTURE_STATUSES.has(normalizeFixtureStatus(status));
}

/**
 * Resolve the placeable state of a single leg from SERVER truth, independent
 * of any client-supplied `fromLive` flag. This is the SOLE decision point for
 * betting eligibility — no caller may branch on raw Redis lock/market-state
 * values themselves; they pass them here.
 *
 * Precedence ladder (top wins; restrictive beats permissive):
 *
 *   #1 Terminal fixture status (DB) ............... → CLOSED
 *   #2 Fixture-level event lock (Plane 1) ......... → LOCKED   (global override)
 *   #3 Market-level operator/provider state (P2) .. → SUSPENDED / LOCKED
 *   #4 In-play leg with no live source ............ → SUSPENDED (fail-closed)
 *   #5 Otherwise .................................. → OPEN
 *
 * @param {{
 *   fixtureStatus: string|null|undefined,
 *   started?: boolean,
 *   hasLiveOdds?: boolean,
 *   hasDbFallback?: boolean,
 *   redisState?: string|null,
 *   lockRemainingMs?: number,
 *   fixtureLockRemainingMs?: number,
 * }} args
 * @returns {{ marketState: string, serverLive: boolean }}
 */
export function resolveLiveLegState({
  fixtureStatus,
  started = false,
  hasLiveOdds = false,
  hasDbFallback = false,
  redisState = null,
  lockRemainingMs = 0,
  fixtureLockRemainingMs = 0,
}) {
  const serverLive = isLiveFixtureStatus(fixtureStatus);

  if (FIXTURE_CLOSED_STATUSES.has(normalizeFixtureStatus(fixtureStatus))) {
    return { marketState: "CLOSED", serverLive };
  }

  if (Number(fixtureLockRemainingMs) > 0) {
    return { marketState: "LOCKED", serverLive };
  }

  let marketState;
  if (serverLive) {
    const operatorState =
      Number(lockRemainingMs) > 0 ? "LOCKED" : redisState || null;
    marketState = resolveMarketState({
      fixtureStatus,
      hasOddLine: Boolean(hasLiveOdds),
      operatorState,
    });
  } else if (!started) {
    marketState = resolveMarketState({
      fixtureStatus,
      hasOddLine: Boolean(hasLiveOdds || hasDbFallback),
      operatorState: redisState || null,
    });
  } else {
    marketState = resolveMarketState({
      fixtureStatus,
      hasOddLine: false,
      operatorState: null,
    });
  }
  return { marketState, serverLive };
}
