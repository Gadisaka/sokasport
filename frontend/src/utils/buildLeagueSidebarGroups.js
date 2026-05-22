import {
  getLeagueRegion,
  REGION_ORDER,
  REGION_LABELS,
} from "./leagueRegions";

/**
 * @param {Array<{ id: string, label?: string, leagueLogo?: string|null, countryFlag?: string|null, pinned?: boolean }>} catalogItems
 *   Ordered list from GET /api/football/sidebar-leagues (empty = fallback to counts-only).
 * @param {Map<string, number>} counts — league display key → match count from client data.
 * @param {Map<string, { leagueLogo?: string|null, countryFlag?: string|null }>} leagueMetaByKey
 */
export function buildLeagueSidebarGroups(
  catalogItems,
  counts,
  leagueMetaByKey,
) {
  const leagueItems = [];
  const seen = new Set();

  if (catalogItems?.length) {
    for (const item of catalogItems) {
      const id = String(item.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const meta = leagueMetaByKey.get(id) || {};
      const count = counts.get(id) || 0;
      const sep = id.indexOf(" - ");
      const labelFromId = sep === -1 ? id : id.slice(sep + 3);
      leagueItems.push({
        id,
        label: String(item.label || "").trim() || labelFromId,
        count,
        leagueLogo: meta.leagueLogo ?? item.leagueLogo ?? null,
        countryFlag: meta.countryFlag ?? item.countryFlag ?? null,
      });
    }
  } else {
    for (const [id, count] of counts) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const sep = id.indexOf(" - ");
      const label = sep === -1 ? id : id.slice(sep + 3);
      const meta = leagueMetaByKey.get(id) || {};
      leagueItems.push({
        id,
        label,
        count,
        leagueLogo: meta.leagueLogo || null,
        countryFlag: meta.countryFlag || null,
      });
    }
  }

  if (catalogItems?.length) {
    for (const [id, count] of counts) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const sep = id.indexOf(" - ");
      const label = sep === -1 ? id : id.slice(sep + 3);
      const meta = leagueMetaByKey.get(id) || {};
      leagueItems.push({
        id,
        label,
        count,
        leagueLogo: meta.leagueLogo || null,
        countryFlag: meta.countryFlag || null,
      });
    }
  }

  const byRegion = new Map();
  const byCountry = new Map();

  for (const leagueItem of leagueItems) {
    const { id } = leagueItem;
    const sep = id.indexOf(" - ");
    const country = sep === -1 ? "Other" : id.slice(0, sep);

    const region = getLeagueRegion(id);
    if (region === "country") {
      if (!byCountry.has(country)) byCountry.set(country, []);
      byCountry.get(country).push(leagueItem);
    } else {
      if (!byRegion.has(region)) byRegion.set(region, []);
      byRegion.get(region).push(leagueItem);
    }
  }

  const regions = REGION_ORDER.filter((r) => byRegion.has(r)).map((region) => {
    const leagues = byRegion.get(region);
    return {
      region,
      label: REGION_LABELS[region],
      leagues: leagues.sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label),
      ),
      matchCount: leagues.reduce((sum, l) => sum + l.count, 0),
    };
  });

  const countries = Array.from(byCountry.entries())
    .map(([country, leagues]) => ({
      country,
      countryFlag: leagues.find((l) => l.countryFlag)?.countryFlag ?? null,
      leagues: leagues.sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label),
      ),
      matchCount: leagues.reduce((sum, l) => sum + l.count, 0),
    }))
    .sort(
      (a, b) =>
        b.matchCount - a.matchCount || a.country.localeCompare(b.country),
    );

  return { regionGroups: regions, countryGroups: countries };
}

/**
 * Options for MatchesTabs league dropdown: “All Leagues” + rows aligned with sidebar catalog order.
 */
export function buildLeagueTabOptions({
  allLeaguesId,
  allMatchesLength,
  catalogItems,
  counts,
  leagueMetaByKey,
}) {
  const head = {
    id: allLeaguesId,
    label: "All Leagues",
    count: allMatchesLength,
    logo: null,
    countryFlag: null,
  };

  if (catalogItems?.length) {
    const catalogIds = new Set(
      catalogItems.map((i) => String(i.id || "").trim()).filter(Boolean),
    );
    const fromCatalog = catalogItems
      .map((item) => {
        const id = String(item.id || "").trim();
        if (!id) return null;
        const meta = leagueMetaByKey.get(id) || {};
        return {
          id,
          label: id,
          count: counts.get(id) || 0,
          logo: meta.leagueLogo ?? item.leagueLogo ?? null,
          countryFlag: meta.countryFlag ?? item.countryFlag ?? null,
        };
      })
      .filter(Boolean);

    const extras = Array.from(counts.entries())
      .filter(([id]) => id && !catalogIds.has(id))
      .map(([league, count]) => {
        const meta = leagueMetaByKey.get(league) || {};
        return {
          id: league,
          label: league,
          count,
          logo: meta.leagueLogo || null,
          countryFlag: meta.countryFlag || null,
        };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return [head, ...fromCatalog, ...extras];
  }

  const dynamic = Array.from(counts.entries())
    .map(([league, count]) => ({
      id: league,
      label: league,
      count,
      logo: leagueMetaByKey.get(league)?.leagueLogo || null,
      countryFlag: leagueMetaByKey.get(league)?.countryFlag || null,
   }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return [head, ...dynamic];
}
