/**
 * Pin order for the sidebar "Top Leagues" section. Match uses the full
 * league key from the API (e.g. "England - Premier League").
 * First matching rule wins (lower index = higher in list).
 */
const TOP_LEAGUE_MATCHERS = [
  (id) => {
    const s = String(id || "");
    return (
      (/champions\s*league/i.test(s) || /uefa\s*cl\b/i.test(s)) &&
      !/afc/i.test(s)
    );
  },
  (id) => {
    const s = String(id || "").toLowerCase();
    return (
      s.includes("premier league") &&
      (s.includes("england") ||
        s.includes("english") ||
        /^england\s*-/i.test(String(id || "")))
    );
  },
  (id) => /la\s*liga|laliga/i.test(String(id || "")),
  (id) => {
    const s = String(id || "");
    return (
      /\bserie\s*a\b/i.test(s) && /italy|italia/i.test(s)
    );
  },
  (id) => /bundesliga/i.test(String(id || "")),
  (id) => /\bligue\s*1\b|\bligue\s+un\b/i.test(String(id || "")),
  (id) =>
    /europa\s*league/i.test(String(id || "")) &&
    !/conference/i.test(String(id || "")),
  (id) => /conference\s*league/i.test(String(id || "")),
  (id) => {
    const s = String(id || "").toLowerCase();
    return s.includes("ethiopia") && s.includes("premier");
  },
];

export function getTopLeagueOrder(leagueId) {
  const id = String(leagueId || "");
  for (let i = 0; i < TOP_LEAGUE_MATCHERS.length; i++) {
    try {
      if (TOP_LEAGUE_MATCHERS[i](id)) return i;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function collectLeagueItems(regionGroups, countryGroups) {
  const byId = new Map();
  for (const g of regionGroups || []) {
    for (const l of g.leagues || []) {
      if (l?.id) byId.set(l.id, l);
    }
  }
  for (const g of countryGroups || []) {
    for (const l of g.leagues || []) {
      if (l?.id) byId.set(l.id, l);
    }
  }
  return Array.from(byId.values());
}
