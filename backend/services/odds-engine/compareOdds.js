import { oddsWithinTolerance } from "./tolerance.js";

export function compareOddsDrift({
  selections = [],
  resolved = [],
  tolerance = 0,
}) {
  const resolvedByIndex = new Map(resolved.map((item) => [item.index, item]));
  const oddsChanges = [];
  const versionChanges = [];
  for (const leg of selections) {
    const current = resolvedByIndex.get(leg.index);
    if (
      !current ||
      !Number.isFinite(current.serverOdds) ||
      current.serverOdds <= 1
    ) {
      continue;
    }
    const submittedVersion = Number(leg.submittedMarketVersion);
    const serverVersion = Number(current.serverMarketVersion);
    // A submitted version of 0 (or NaN) is the "client never received a server
    // version" sentinel — e.g. compact six-cell strip selections, which carry no
    // market version. Real versions are always >= 1 (fnv1a32 hashes /
    // bumpMarketVersion), so only gate on version drift when the client actually
    // sent one. Odds drift below still protects these legs.
    if (
      Number.isFinite(submittedVersion) &&
      submittedVersion > 0 &&
      Number.isFinite(serverVersion) &&
      submittedVersion !== serverVersion
    ) {
      versionChanges.push({
        index: leg.index,
        submittedMarketVersion: submittedVersion,
        serverMarketVersion: serverVersion,
        marketState: current.marketState || "OPEN",
        marketLabel: leg.marketLabel || null,
        label: leg.label || null,
      });
    }
    const within = oddsWithinTolerance(
      leg.submittedOdds,
      current.serverOdds,
      tolerance,
    );
    if (within) continue;
    oddsChanges.push({
      index: leg.index,
      submittedOdds: Number(leg.submittedOdds),
      serverOdds: Number(current.serverOdds),
      tolerance: Number(tolerance),
      marketState: current.marketState || "OPEN",
      marketLabel: leg.marketLabel || null,
      label: leg.label || null,
    });
  }
  return { oddsChanges, versionChanges };
}
