/**
 * Backward-compatible football API surface.
 *
 * The real HTTP logic now lives in `apiSportsService.js` and is sport-aware.
 * This module keeps the original named exports (`getLeagues`, `getTeams`,
 * `getFixtures`, `getOdds`, `getLiveFixtures`, `sleep`, `getDailyCallCount`)
 * so existing imports (routes/jobs) continue to work unchanged while the
 * rest of the codebase migrates to `api(sportSlug)` from apiSportsService.
 */

import {
  api,
  sleep,
  getDailyCallCount as getDailyCallCountMulti,
} from "./apiSportsService.js";

const football = api("football");

export { sleep };

export function getDailyCallCount() {
  return getDailyCallCountMulti("football");
}

export function getLeagues() {
  return football.getLeagues();
}

export function getTeams(leagueId, season) {
  return football.getTeams(leagueId, season);
}

export function getFixtures(leagueId, season, date) {
  return football.getFixtures(leagueId, season, date);
}

export function getOdds(fixtureId) {
  return football.getOdds(fixtureId);
}

export function getLiveFixtures() {
  return football.getLiveFixtures();
}
