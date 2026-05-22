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
  const op = String(operatorState || "")
    .trim()
    .toUpperCase();
  if (op === "LOCKED" || op === "SUSPENDED" || op === "CLOSED") {
    return op;
  }
  const normalizedStatus = normalizeFixtureStatus(fixtureStatus);
  if (FIXTURE_CLOSED_STATUSES.has(normalizedStatus)) {
    return "CLOSED";
  }
  if (!hasOddLine) {
    return "SUSPENDED";
  }
  return "OPEN";
}
