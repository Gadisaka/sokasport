import { getTopLeagueOrder } from "./topLeagues.js";

const NON_TOP_RANK = 1000;

export function kickoffMs(match) {
  const ts = match?.kickoffAt ? new Date(match.kickoffAt).getTime() : NaN;
  return Number.isFinite(ts) ? ts : Infinity;
}

export function leagueRank(leagueKey) {
  const o = getTopLeagueOrder(leagueKey);
  return o === null ? NON_TOP_RANK : o;
}

/** Chronological kickoff within the same competition. */
export function compareMatchesByKickoff(a, b) {
  const ka = kickoffMs(a);
  const kb = kickoffMs(b);
  if (ka !== kb) return ka - kb;
  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

function earliestKickMs(leagueMatches) {
  let min = Infinity;
  for (const m of leagueMatches) {
    min = Math.min(min, kickoffMs(m));
  }
  return min;
}

export function compareLeagueGroups(la, ma, lb, mb) {
  const ra = leagueRank(la);
  const rb = leagueRank(lb);
  if (ra !== rb) return ra - rb;
  const ka = earliestKickMs(ma);
  const kb = earliestKickMs(mb);
  if (ka !== kb) return ka - kb;
  return String(la).localeCompare(String(lb));
}

/** Flat list: pinned leagues first (in top order), then all others by kickoff time. */
export function compareMatchesForDisplay(a, b) {
  const ra = leagueRank(a?.league);
  const rb = leagueRank(b?.league);
  if (ra !== rb) return ra - rb;

  const la = String(a?.league ?? "");
  const lb = String(b?.league ?? "");
  if (la !== lb && ra < NON_TOP_RANK) {
    return la.localeCompare(lb);
  }

  return compareMatchesByKickoff(a, b);
}

export function sortMatchesForDisplay(matches) {
  return [...(matches || [])].sort(compareMatchesForDisplay);
}

/** Group by league; top leagues pinned on top; fixtures sorted by kickoff inside each league. */
export function groupMatchesByLeague(matches) {
  const groups = new Map();
  for (const match of matches || []) {
    const key = match.league || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(match);
  }

  for (const list of groups.values()) {
    list.sort(compareMatchesByKickoff);
  }

  return Array.from(groups.entries()).sort(([la, ma], [lb, mb]) =>
    compareLeagueGroups(la, ma, lb, mb),
  );
}
