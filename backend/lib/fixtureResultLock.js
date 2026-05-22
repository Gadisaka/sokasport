/**
 * Guards admin-overridden fixture results from being overwritten by
 * API-Sports sync jobs (`syncFixtures`, `syncLiveFixtures`).
 *
 * @module lib/fixtureResultLock
 */

/**
 * @param {{ result_locked_at?: Date | string | null } | null | undefined} fixture
 */
export function isFixtureResultLocked(fixture) {
  return fixture?.result_locked_at != null;
}

/**
 * Merge upstream ingest fields with an existing row, preserving
 * result fields when the admin has locked the fixture.
 *
 * @param {object} existing - DB fixture row (needs result_locked_at)
 * @param {object} incoming - { status, home_score, away_score, start_time, league_id, home_team_id, away_team_id }
 * @returns {object} Prisma `data` payload for fixture.update
 */
export function buildFixtureSyncData(existing, incoming) {
  const base = {
    start_time: incoming.start_time,
    league_id: incoming.league_id,
    home_team_id: incoming.home_team_id,
    away_team_id: incoming.away_team_id,
  };
  if (isFixtureResultLocked(existing)) {
    return base;
  }
  return {
    ...base,
    status: incoming.status,
    home_score: incoming.home_score,
    away_score: incoming.away_score,
  };
}

/**
 * Shallow equality for deciding whether a sync tick can skip the write.
 *
 * @param {object} existing
 * @param {object} incoming - same shape as buildFixtureSyncData incoming
 */
export function fixtureSyncUnchanged(existing, incoming) {
  const data = buildFixtureSyncData(existing, incoming);
  if (
    !(existing.start_time instanceof Date) ||
    existing.start_time.getTime() !== incoming.start_time.getTime()
  ) {
    return false;
  }
  if (existing.league_id !== incoming.league_id) return false;
  if (existing.home_team_id !== incoming.home_team_id) return false;
  if (existing.away_team_id !== incoming.away_team_id) return false;
  if (!isFixtureResultLocked(existing)) {
    if (existing.status !== incoming.status) return false;
    if (existing.home_score !== incoming.home_score) return false;
    if (existing.away_score !== incoming.away_score) return false;
  }
  return true;
}
