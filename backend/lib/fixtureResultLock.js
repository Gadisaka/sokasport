/**
 * Guards admin-overridden fixture results from being overwritten by
 * API-Sports sync jobs (`syncFixtures`, `syncLiveFixtures`).
 *
 * @module lib/fixtureResultLock
 */

import { resolvePostponedAtOnSync } from "./postponedSettlement.js";

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
 * @param {object} incoming - { status, home_score, away_score, ht_home_score,
 *   ht_away_score, et_home_score, et_away_score, pen_home_score, pen_away_score,
 *   start_time, league_id, home_team_id, away_team_id }
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
  const data = {
    ...base,
    status: incoming.status,
    home_score: incoming.home_score,
    away_score: incoming.away_score,
    postponed_at: resolvePostponedAtOnSync(existing, incoming),
  };
  // Half-time scores: only write when the upstream provided them (avoid
  // clobbering a stored HT score with null on a later tick that omits it).
  if (incoming.ht_home_score != null) data.ht_home_score = incoming.ht_home_score;
  if (incoming.ht_away_score != null) data.ht_away_score = incoming.ht_away_score;
  // Extra-time / penalty scores: same presence-guarded write as HT. These are
  // only populated on terminal AET/PEN fixtures and let settlement expose the
  // 90' regulation score separately from the ET/shootout totals.
  if (incoming.et_home_score != null) data.et_home_score = incoming.et_home_score;
  if (incoming.et_away_score != null) data.et_away_score = incoming.et_away_score;
  if (incoming.pen_home_score != null) data.pen_home_score = incoming.pen_home_score;
  if (incoming.pen_away_score != null) data.pen_away_score = incoming.pen_away_score;
  return data;
}

/**
 * Shallow equality for deciding whether a sync tick can skip the write.
 *
 * @param {object} existing
 * @param {object} incoming - same shape as buildFixtureSyncData incoming
 */
export function fixtureSyncUnchanged(existing, incoming) {
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
    // A newly-arrived HT score (upstream now provides it, stored is null)
    // must trigger a write so HT markets can settle.
    if (
      incoming.ht_home_score != null &&
      existing.ht_home_score !== incoming.ht_home_score
    ) {
      return false;
    }
    if (
      incoming.ht_away_score != null &&
      existing.ht_away_score !== incoming.ht_away_score
    ) {
      return false;
    }
    // A newly-arrived ET/penalty score (terminal AET/PEN) must trigger a write.
    if (
      incoming.et_home_score != null &&
      existing.et_home_score !== incoming.et_home_score
    ) {
      return false;
    }
    if (
      incoming.et_away_score != null &&
      existing.et_away_score !== incoming.et_away_score
    ) {
      return false;
    }
    if (
      incoming.pen_home_score != null &&
      existing.pen_home_score !== incoming.pen_home_score
    ) {
      return false;
    }
    if (
      incoming.pen_away_score != null &&
      existing.pen_away_score !== incoming.pen_away_score
    ) {
      return false;
    }
  }
  return true;
}
