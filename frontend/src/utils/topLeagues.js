/**
 * Pin order for top leagues in match lists and the sidebar "Top Leagues" section.
 * Match uses the full league key from the API (e.g. "England - Premier League").
 * First matching rule wins (lower index = higher in list).
 */
function leagueKey(id) {
  return String(id || "");
}

function lower(id) {
  return leagueKey(id).toLowerCase();
}

function isEthiopia(id) {
  return lower(id).includes("ethiopia");
}

function isEngland(id) {
  const s = lower(id);
  return (
    s.includes("england") ||
    s.includes("english") ||
    /^england\s*-/i.test(leagueKey(id))
  );
}

function isSpain(id) {
  const s = lower(id);
  return s.includes("spain") || s.includes("spanish") || /^spain\s*-/i.test(leagueKey(id));
}

function isGermany(id) {
  const s = lower(id);
  return (
    s.includes("germany") ||
    s.includes("german") ||
    /^germany\s*-/i.test(leagueKey(id))
  );
}

function isItaly(id) {
  const s = lower(id);
  return s.includes("italy") || s.includes("italia") || /^italy\s*-/i.test(leagueKey(id));
}

function isFrance(id) {
  const s = lower(id);
  return s.includes("france") || s.includes("french") || /^france\s*-/i.test(leagueKey(id));
}

const TOP_LEAGUE_MATCHERS = [
  (id) => isEthiopia(id) && /premier/i.test(lower(id)),
  (id) => isEthiopia(id) && /cup/i.test(lower(id)),
  (id) =>
    isEngland(id) &&
    /premier\s*league/i.test(lower(id)) &&
    !/championship|league\s*one|league\s*two|national\s*league/i.test(lower(id)),
  (id) =>
    isEngland(id) &&
    /fa\s*cup|efl\s*cup|carabao|league\s*cup|community\s*shield/i.test(lower(id)),
  (id) =>
    isSpain(id) &&
    (/la\s*liga|laliga/i.test(lower(id)) || /\bprimera\s*divisi[oó]n\b/i.test(lower(id))) &&
    !/segunda|2\s*divisi|second\s*division/i.test(lower(id)),
  (id) => isSpain(id) && /copa\s*del\s*rey|supercopa/i.test(lower(id)),
  (id) =>
    isGermany(id) &&
    /bundesliga/i.test(lower(id)) &&
    !/2\.?\s*bundesliga|zweite|2\.\s*bundes/i.test(lower(id)),
  (id) => isGermany(id) && /dfb[\s-]*pokal|dfb\s*cup/i.test(lower(id)),
  (id) =>
    isItaly(id) &&
    /\bserie\s*a\b/i.test(lower(id)) &&
    !/serie\s*b/i.test(lower(id)),
  (id) => isItaly(id) && /coppa\s*italia/i.test(lower(id)),
  (id) =>
    isFrance(id) &&
    /\bligue\s*1\b|\bligue\s+un\b/i.test(lower(id)) &&
    !/ligue\s*2/i.test(lower(id)),
  (id) => isFrance(id) && /coupe\s*de\s*france/i.test(lower(id)),
  (id) => {
    const s = leagueKey(id);
    return (
      (/champions\s*league/i.test(s) || /uefa\s*cl\b/i.test(s)) && !/afc/i.test(s)
    );
  },
  (id) =>
    /europa\s*league/i.test(leagueKey(id)) && !/conference/i.test(leagueKey(id)),
  (id) => /conference\s*league/i.test(leagueKey(id)),
];

export function getTopLeagueOrder(leagueId) {
  const id = leagueKey(leagueId);
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
