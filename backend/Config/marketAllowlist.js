/**
 * SETTLEMENT-DRIVEN MARKET ALLOWLIST (single source of truth).
 *
 * Goal: customers may only place markets that can settle correctly; everything
 * else is hidden. Derived from the read-only coverage audit
 * (scripts/marketCoverageReport.js + scripts/liveMarketCoverageReport.js,
 * artifacts in docs/coverage/). Provider ids are API-Sports bet ids:
 *   - PREMATCH ids = `odds/bets` scheme (matches apiSportsBetIdMap.generated.js)
 *   - LIVE ids     = `odds/live/bets` scheme (DIFFERENT numbering; needs its own
 *                    id->code map before any live market can be offered)
 *
 * Phases reflect what must ship before each set is safe to expose:
 *   TODAY      → settles now under the active V1 engine
 *   AFTER_V2   → settles once SETTLEMENT_ENGINE=v2 (+ enrichment) is live
 *   LIVE       → settles once the live id->code map AND V2 are live
 *
 * Backend stays authoritative: even with the UI gated, placement must reject
 * any market_code that does not resolve to a real grader.
 */

// Prematch odds/bets ids that settle correctly under V1 right now.
export const PREMATCH_ALLOW_TODAY = Object.freeze([1, 5, 8, 12]);
// Match Winner(1), Goals O/U(5), BTTS(8), Double Chance(12)

// Prematch odds/bets ids that settle once V2 is the engine.
export const PREMATCH_ALLOW_AFTER_V2 = Object.freeze([
  2, 4, 9, 10, 16, 17, 21, 23, 45, 47, 60, 80, 86, 92, 93, 94, 96, 102, 103,
  218, 219, 226, 231, 232, 233, 251, 335,
]);

// Live odds/live/bets ids that settle once the live id->code map + V2 ship.
// NOT offerable today (live placement currently stores null market_code).
export const LIVE_ALLOW_AFTER_MAP_V2 = Object.freeze([
  20, 21, 23, 25, 32, 33, 36, 37, 39, 46, 48, 58, 59, 63, 68, 69, 72, 115, 118,
  119, 169, 176, 210, 215, 219, 229, 230, 232,
]);

/** Markets safe to expose RIGHT NOW (prematch only). */
export const ALLOWLIST_TODAY = Object.freeze({
  prematch: PREMATCH_ALLOW_TODAY,
  live: Object.freeze([]), // none until live-id map ships
});

export function isPrematchAllowedToday(betId) {
  return PREMATCH_ALLOW_TODAY.includes(Number(betId));
}

// ---------------------------------------------------------------------------
// Canonical-code allowlist (what the placement guard + odds filter enforce).
//
// Bet ids identify a market at PLACEMENT time, but settlement keys off the
// canonical `market_code`. The guard therefore enforces on resolved codes.
// Phases are additive and selected by MARKET_ALLOWLIST_PHASE (default "today").
// Expanding a phase ships more markets with NO code change.
// ---------------------------------------------------------------------------

// Settles correctly under the ACTIVE V1 engine today.
// NOTE: V1's only handlers are MATCH_WINNER, DOUBLE_CHANCE, OVER_UNDER, BTTS,
// HANDICAP. Asian/European handicap canonical codes are NOT graded by V1's
// single HANDICAP handler, so they are intentionally excluded until V2.
export const CODES_TODAY = Object.freeze([
  "MATCH_WINNER",
  "OVER_UNDER",
  "BTTS",
  "DOUBLE_CHANCE",
]);

// SCORE-DERIVABLE markets: gradable by V2 from the final score alone (no
// enrichment, no events). Proven by the shadow run (FLIP=0) + the Phase-1 label
// fallback. Safe to expose as soon as V2 is the engine. This is the "widest
// safe prematch" tier.
export const CODES_SCORE = Object.freeze([
  ...CODES_TODAY,
  "HOME_AWAY",
  "DRAW_NO_BET",
  "HANDICAP_ASIAN",
  "HANDICAP_EUROPEAN",
  "CORRECT_SCORE",
  "TEAM_TOTAL_HOME",
  "TEAM_TOTAL_AWAY",
  "ODD_EVEN",
  "ODD_EVEN_HOME_TEAM",
  "ODD_EVEN_AWAY_TEAM",
  "WINNING_MARGIN",
  // Stream 1 — FT-score-derived (universal data, grade on ~100% of fixtures).
  "CLEAN_SHEET_HOME",
  "CLEAN_SHEET_AWAY",
  "CLEAN_SHEET_EITHER",
  "WIN_TO_NIL_HOME",
  "WIN_TO_NIL_AWAY",
  "TEAM_TO_SCORE_YESNO_HOME",
  "TEAM_TO_SCORE_YESNO_AWAY",
  "SCORING_DRAW",
  "EXACT_GOALS_FT",
  "EXACT_GOALS_HOME_FT",
  "EXACT_GOALS_AWAY_FT",
  "GOAL_LINE_FT",
  // Combination markets (score-derived AND of two outcomes; acca-popular).
  "RESULT_TOTAL_FT",
  "TOTAL_GOALS_BTTS",
  "RESULT_BTTS_FT",
  "WIN_TO_NIL",
  "DOUBLE_CHANCE_TOTAL_FT",
  "DOUBLE_CHANCE_BTTS_FT",
]);

// HALF-TIME markets: need ht_home_score/ht_away_score ingested (Tier C). Enable
// only after the syncFixtures HT-score ingest is live and verified.
export const CODES_HALFTIME = Object.freeze([
  ...CODES_SCORE,
  "HALF_TIME_RESULT",
  "HT_OVER_UNDER",
  "HT_FT",
  // Stream 1 — half-dependent score markets (need HT + derived 2H scores).
  "HIGHEST_SCORING_HALF",
  "WIN_BOTH_HALVES",
  "WIN_EITHER_HALF_HOME",
  "WIN_EITHER_HALF_AWAY",
  // Stream 5 — team-to-score-in-half (score-derived, universal HT/2H).
  "TEAM_TO_SCORE_YESNO_HOME_HT",
  "TEAM_TO_SCORE_YESNO_AWAY_HT",
  "TEAM_TO_SCORE_YESNO_HOME_SH",
  "TEAM_TO_SCORE_YESNO_AWAY_SH",
]);

// ENRICHED-STAT markets: need stats_payload populated by enrichFixtureResult
// (Tier B). Enable only after confirming enrichment writes corners/cards on
// finished fixtures. VOID-safe if data is missing (data-presence fix), but only
// offer once data is verified flowing.
export const CODES_ENRICHED = Object.freeze([
  ...CODES_HALFTIME,
  "CORNERS_OVER_UNDER",
  "CARDS_OVER_UNDER",
  // Stream 5 — first/last team to score (need goal events from enrichment).
  "TEAM_FIRST_GOAL",
  "FIRST_TEAM_SCORE",
  "TEAM_LAST_GOAL",
  "LAST_TEAM_SCORE",
  // Stream 2 — corner/card variants (per-team stat counts; league-gated).
  "CORNERS_1X2_FT",
  "CORNERS_HANDICAP_ASIAN",
  "CORNERS_TEAM_OU_HOME_FT",
  "CORNERS_TEAM_OU_AWAY_FT",
  "CARDS_1X2_FT",
  "CARDS_ASIAN_HANDICAP",
  "CARDS_HANDICAP_EUROPEAN",
  "CARDS_TEAM_TOTAL_HOME",
  "CARDS_TEAM_TOTAL_AWAY",
  // Stream 3 — offsides / fouls / saves / shots (league-gated, fail-closed).
  "OFFSIDES_OVER_UNDER", "OFFSIDES_1X2", "OFFSIDES_TEAM_HOME", "OFFSIDES_TEAM_AWAY",
  "OFFSIDES_HANDICAP", "OFFSIDES_ODD_EVEN",
  "FOULS_OVER_UNDER", "FOULS_1X2", "FOULS_TEAM_HOME", "FOULS_TEAM_AWAY",
  "FOULS_HANDICAP", "FOULS_ODD_EVEN",
  "SAVES_OVER_UNDER", "SAVES_1X2", "SAVES_TEAM_HOME", "SAVES_TEAM_AWAY",
  "SAVES_HANDICAP", "SAVES_ODD_EVEN",
  "SHOTS_OVER_UNDER", "SHOTS_1X2",
  "SHOTS_ON_TARGET_TEAM_HOME", "SHOTS_ON_TARGET_TEAM_AWAY",
]);

// Backwards-compat alias: the previous "v2" phase = the full enriched set.
export const CODES_AFTER_V2 = CODES_ENRICHED;

// After the live id->code map ships, the same codes apply on the live channel.
export const CODES_AFTER_LIVE = CODES_ENRICHED;

const PHASE_CODES = Object.freeze({
  today: new Set(CODES_TODAY),
  score: new Set(CODES_SCORE),
  halftime: new Set(CODES_HALFTIME),
  enriched: new Set(CODES_ENRICHED),
  // `v2` kept as an alias for the full enriched set (back-compat).
  v2: new Set(CODES_ENRICHED),
  live: new Set(CODES_AFTER_LIVE),
});

/** Active phase from env (default "today"). */
export function activeAllowlistPhase() {
  const p = String(process.env.MARKET_ALLOWLIST_PHASE || "today")
    .toLowerCase()
    .trim();
  return PHASE_CODES[p] ? p : "today";
}

/** Canonical-code Set for the active phase. */
export function allowedCodes() {
  return PHASE_CODES[activeAllowlistPhase()];
}

/** Is this canonical code allowed in the active phase? */
export function isCodeAllowed(code) {
  if (!code) return false;
  return allowedCodes().has(String(code).toUpperCase().trim());
}
