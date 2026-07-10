import { getTopLeagueOrder } from "./topLeagues.js";

const NON_TOP_RANK = 1000;

export function kickoffMs(match) {
  const ts = match?.kickoffAt ? new Date(match.kickoffAt).getTime() : NaN;
  return Number.isFinite(ts) ? ts : Infinity;
}

/** Prefer API league.rank; fall back to client topLeagues matchers. */
export function leagueRank(leagueKeyOrMatch) {
  if (
    leagueKeyOrMatch &&
    typeof leagueKeyOrMatch === "object" &&
    Number.isFinite(Number(leagueKeyOrMatch.leagueRank))
  ) {
    return Number(leagueKeyOrMatch.leagueRank);
  }
  const key =
    typeof leagueKeyOrMatch === "string"
      ? leagueKeyOrMatch
      : leagueKeyOrMatch?.league;
  const o = getTopLeagueOrder(key);
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

function groupLeagueRank(leagueMatches, leagueKey) {
  const fromApi = leagueMatches[0]?.leagueRank;
  if (Number.isFinite(Number(fromApi))) return Number(fromApi);
  return leagueRank(leagueKey);
}

export function compareLeagueGroups(la, ma, lb, mb) {
  const ra = groupLeagueRank(ma, la);
  const rb = groupLeagueRank(mb, lb);
  if (ra !== rb) return ra - rb;
  const ka = earliestKickMs(ma);
  const kb = earliestKickMs(mb);
  if (ka !== kb) return ka - kb;
  return String(la).localeCompare(String(lb));
}

/** Flat list: ranked leagues first, then kickoff within league. */
export function compareMatchesForDisplay(a, b) {
  const ra = leagueRank(a);
  const rb = leagueRank(b);
  if (ra !== rb) return ra - rb;

  const la = String(a?.league ?? "");
  const lb = String(b?.league ?? "");
  if (la !== lb) {
    return la.localeCompare(lb);
  }

  return compareMatchesByKickoff(a, b);
}

export function sortMatchesForDisplay(matches) {
  return [...(matches || [])].sort(compareMatchesForDisplay);
}

/** Group by league; sort groups by API leagueRank then kickoff inside each. */
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
