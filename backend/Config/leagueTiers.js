import { getLeagueTierMap } from "./ingestionConfig.js";
import { getLeagueRank } from "./leagueRanks.js";

const DEFAULT_TIER = 1;

/**
 * Tier for prioritizing odds sync (0 = elite). When LEAGUE_TIERS_JSON is unset,
 * league rank from leagueRanks.js is used as the tier (lower rank = higher priority).
 */
export function getLeagueTier(apiLeagueId) {
  if (apiLeagueId == null || !Number.isFinite(Number(apiLeagueId))) {
    return DEFAULT_TIER;
  }
  const map = getLeagueTierMap();
  if (map.size) {
    const t = map.get(Number(apiLeagueId));
    return Number.isFinite(t) ? t : DEFAULT_TIER;
  }
  return getLeagueRank(Number(apiLeagueId));
}

/**
 * Rank fixtures for capped odds ingestion: optional near-window bucket first,
 * then elite leagues (tier ascending), then kickoff time.
 */
export function sortFixturesForOddsIngest(fixtures, { nearPriorityEnd } = {}) {
  const enableNear = nearPriorityEnd != null;
  const endTs = enableNear ? nearPriorityEnd.getTime() : null;
  return [...fixtures].sort((a, b) => {
    if (enableNear && endTs != null) {
      const na = new Date(a.start_time).getTime() <= endTs ? 0 : 1;
      const nb = new Date(b.start_time).getTime() <= endTs ? 0 : 1;
      if (na !== nb) return na - nb;
    }
    const tierA = getLeagueTier(a.league?.api_league_id ?? null);
    const tierB = getLeagueTier(b.league?.api_league_id ?? null);
    if (tierA !== tierB) return tierA - tierB;
    return (
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );
  });
}
