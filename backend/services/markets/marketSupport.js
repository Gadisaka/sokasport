/**
 * Shared market-support classifier — the single source of truth for "can this
 * selection settle, and is it allowed to be offered?".
 *
 * Used by the placement guard (both ticket paths) AND the public odds filter, so
 * a market can never be placed unless it would settle, and is never served to a
 * client unless allowed. Pure / no I/O — unit-tested.
 *
 * Pipeline (in order):
 *   1. resolve canonical code (registry alias / bet-id / label / selection)
 *   2. name↔code consistency (blocks the 13 mis-mapped markets that resolve to a
 *      base goals code but whose provider name names a different stat/period/combo)
 *   3. has a REAL settlement grader (not the catalog VOID default)
 *   4. allowlist (strict mode only) — code is in the active phase's allowed set
 *
 * Returns { ok, code, params, reason }. On ok, `code`/`params` are the resolved
 * canonical values to STORE — this also closes the null-`market_code` hole.
 *
 * @module services/markets/marketSupport
 */
import { MARKET_REGISTRY, MarketUnknownError } from "./registry.js";
import { isCodeAllowed } from "../../Config/marketAllowlist.js";
import { catalogHasHandler } from "./apiSportsCatalogHandlers.js";

// Canonical codes that have a REAL grader (core modules + catalog reg() handlers).
// Everything else resolves to the catalog VOID default → unsettleable. Mirrors
// the coverage audit's REAL_GRADERS (scripts/marketCoverageReport.js).
export const REAL_GRADER_CODES = new Set([
  "MATCH_WINNER", "DOUBLE_CHANCE", "DRAW_NO_BET", "HOME_AWAY", "OVER_UNDER",
  "BTTS", "ODD_EVEN", "CORRECT_SCORE", "WINNING_MARGIN", "HALF_TIME_RESULT",
  "HT_OVER_UNDER", "HT_FT", "TEAM_TOTAL", "HANDICAP_ASIAN", "HANDICAP_EUROPEAN",
  "GOALSCORER_ANYTIME", "FIRST_GOALSCORER", "LAST_GOALSCORER", "CARDS_OVER_UNDER",
  "CORNERS_OVER_UNDER", "PLAYER_CARDS", "PLAYER_SHOTS", "SECOND_HALF_RESULT",
  "SH_OVER_UNDER", "HANDICAP_ASIAN_HT", "HANDICAP_ASIAN_SH", "HANDICAP_EUROPEAN_HT",
  "HANDICAP_EUROPEAN_SH", "DOUBLE_CHANCE_HT", "DOUBLE_CHANCE_SH", "ODD_EVEN_HT",
  "ODD_EVEN_SH", "ODD_EVEN_HOME_TEAM", "ODD_EVEN_AWAY_TEAM", "CORRECT_SCORE_HT",
  "CORRECT_SCORE_SH", "BTTS_HT", "BTTS_SH", "DRAW_NO_BET_HT", "DRAW_NO_BET_SH",
  "TEAM_TOTAL_HOME", "TEAM_TOTAL_AWAY", "GOALSCORER_ANYTIME_HOME",
  "GOALSCORER_ANYTIME_AWAY", "FIRST_GOALSCORER_HOME", "FIRST_GOALSCORER_AWAY",
  "LAST_GOALSCORER_HOME", "LAST_GOALSCORER_AWAY", "PLAYER_SHOTS_HOME_WRAPPER",
  "PLAYER_SHOTS_AWAY_WRAPPER",
  // Stream 1 — score-derived catalog handlers (apiSportsCatalogHandlers.js).
  "CLEAN_SHEET_HOME", "CLEAN_SHEET_AWAY", "CLEAN_SHEET_EITHER",
  "WIN_TO_NIL_HOME", "WIN_TO_NIL_AWAY", "TEAM_TO_SCORE_YESNO_HOME",
  "TEAM_TO_SCORE_YESNO_AWAY", "SCORING_DRAW", "WIN_EITHER_HALF_HOME",
  "WIN_EITHER_HALF_AWAY", "EXACT_GOALS_FT", "EXACT_GOALS_HOME_FT",
  "EXACT_GOALS_AWAY_FT", "HIGHEST_SCORING_HALF", "WIN_BOTH_HALVES",
  "GOAL_LINE_FT",
  // Stream 5 — event team-level + half team-to-score.
  "TEAM_FIRST_GOAL", "FIRST_TEAM_SCORE", "TEAM_LAST_GOAL", "LAST_TEAM_SCORE",
  "TEAM_TO_SCORE_YESNO_HOME_HT", "TEAM_TO_SCORE_YESNO_AWAY_HT",
  "TEAM_TO_SCORE_YESNO_HOME_SH", "TEAM_TO_SCORE_YESNO_AWAY_SH",
  // Stream 2 — corner/card variants (per-team stat counts; league-gated).
  "CORNERS_1X2_FT", "CORNERS_HANDICAP_ASIAN", "CORNERS_TEAM_OU_HOME_FT",
  "CORNERS_TEAM_OU_AWAY_FT", "CARDS_1X2_FT", "CARDS_ASIAN_HANDICAP",
  "CARDS_HANDICAP_EUROPEAN", "CARDS_TEAM_TOTAL_HOME", "CARDS_TEAM_TOTAL_AWAY",
  // Stream 3 — additional team stats (offsides/fouls/saves/shots; league-gated).
  "OFFSIDES_OVER_UNDER", "OFFSIDES_1X2", "OFFSIDES_TEAM_HOME", "OFFSIDES_TEAM_AWAY",
  "OFFSIDES_HANDICAP", "OFFSIDES_ODD_EVEN",
  "FOULS_OVER_UNDER", "FOULS_1X2", "FOULS_TEAM_HOME", "FOULS_TEAM_AWAY",
  "FOULS_HANDICAP", "FOULS_ODD_EVEN",
  "SAVES_OVER_UNDER", "SAVES_1X2", "SAVES_TEAM_HOME", "SAVES_TEAM_AWAY",
  "SAVES_HANDICAP", "SAVES_ODD_EVEN",
  "SHOTS_OVER_UNDER", "SHOTS_1X2",
  "SHOTS_ON_TARGET_TEAM_HOME", "SHOTS_ON_TARGET_TEAM_AWAY",
  // Combination markets (score-derived AND of two outcomes).
  "RESULT_TOTAL_FT", "TOTAL_GOALS_BTTS", "RESULT_BTTS_FT", "WIN_TO_NIL",
]);

// Base goals/result graders (decide off the goal score only). A stat-qualified
// or compound provider name resolving to one of these = a mis-map.
const BASE_GOALS_CODES = new Set([
  "MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS", "ODD_EVEN",
  "HANDICAP_ASIAN", "HANDICAP_EUROPEAN", "DRAW_NO_BET", "CORRECT_SCORE",
  "WINNING_MARGIN", "HOME_AWAY", "TEAM_TOTAL_HOME", "TEAM_TOTAL_AWAY",
  "ODD_EVEN_HOME_TEAM", "ODD_EVEN_AWAY_TEAM",
]);

const norm = (s) => String(s || "").toUpperCase().trim();

// Provider DISPLAY NAME → canonical code. Keys are the EXACT API-Sports
// `odds/bets` market names (the 337-market prematch catalogue), lowercased.
// The registry's resolveCode keys on canonical codes / underscore aliases, NOT
// provider display strings, so the odds filter + UI hide (which see provider
// names) need this explicit map. The `mappingMismatch` guard additionally
// rejects stat/period-qualified variants ("Yellow …", "… First Half"), so only
// the exact base name resolves. Whether a resolved code is actually OFFERED is
// gated by the active allowlist phase (isCodeAllowed) — so listing a name here
// is safe even if its phase isn't enabled yet.
const PROVIDER_NAME_TO_CODE = new Map([
  // result / match winner
  ["match winner", "MATCH_WINNER"],
  ["1x2", "MATCH_WINNER"],
  ["fulltime result", "MATCH_WINNER"],
  ["final score", "MATCH_WINNER"],
  ["home/away", "HOME_AWAY"],
  ["double chance", "DOUBLE_CHANCE"],
  ["draw no bet", "DRAW_NO_BET"],
  // totals
  ["goals over/under", "OVER_UNDER"],
  ["over/under", "OVER_UNDER"],
  ["over/under line", "OVER_UNDER"],
  ["goal line", "OVER_UNDER"],
  ["match goals", "OVER_UNDER"],
  ["total - home", "TEAM_TOTAL_HOME"],
  ["total - away", "TEAM_TOTAL_AWAY"],
  // btts
  ["both teams score", "BTTS"],
  ["both teams to score", "BTTS"],
  // handicap
  ["asian handicap", "HANDICAP_ASIAN"],
  ["handicap result", "HANDICAP_EUROPEAN"],
  // correct score / exact
  ["exact score", "CORRECT_SCORE"],
  ["correct score", "CORRECT_SCORE"],
  // odd/even
  ["odd/even", "ODD_EVEN"],
  ["home odd/even", "ODD_EVEN_HOME_TEAM"],
  ["away odd/even", "ODD_EVEN_AWAY_TEAM"],
  // winning margin
  ["winning margin", "WINNING_MARGIN"],
  // half-time (Tier C — resolves, but only offered when phase=halftime+)
  ["first half winner", "HALF_TIME_RESULT"],
  ["goals over/under first half", "HT_OVER_UNDER"],
  ["ht/ft double", "HT_FT"],
  // enriched (Tier B — resolves, offered when phase=enriched)
  ["corners over under", "CORNERS_OVER_UNDER"],
  ["cards over/under", "CARDS_OVER_UNDER"],

  // --- Stream 1 / 5 / 2 prematch expansion markets (exact odds/bets names) ---
  // Only scope-exact base names; period/minute/set/red-only-qualified variants
  // are EXCLUDED (they'd mis-grade) and rejected by the mappingMismatch guard.
  // Score-derived (Stream 1)
  ["clean sheet", "CLEAN_SHEET_EITHER"],
  ["clean sheet - home", "CLEAN_SHEET_HOME"],
  ["clean sheet - away", "CLEAN_SHEET_AWAY"],
  ["win to nil - home", "WIN_TO_NIL_HOME"],
  ["win to nil - away", "WIN_TO_NIL_AWAY"],
  ["home team score a goal", "TEAM_TO_SCORE_YESNO_HOME"],
  ["away team score a goal", "TEAM_TO_SCORE_YESNO_AWAY"],
  ["scoring draw", "SCORING_DRAW"],
  ["exact goals number", "EXACT_GOALS_FT"],
  ["home team exact goals number", "EXACT_GOALS_HOME_FT"],
  ["away team exact goals number", "EXACT_GOALS_AWAY_FT"],
  ["highest scoring half", "HIGHEST_SCORING_HALF"],
  ["win both halves", "WIN_BOTH_HALVES"],
  ["home team will win either half", "WIN_EITHER_HALF_HOME"],
  ["away team will win either half", "WIN_EITHER_HALF_AWAY"],
  // Event team-level (Stream 5)
  ["first team to score", "FIRST_TEAM_SCORE"],
  ["last team to score", "LAST_TEAM_SCORE"],
  ["team to score first", "TEAM_FIRST_GOAL"],
  ["team to score last", "TEAM_LAST_GOAL"],
  // Corner/card variants (Stream 2)
  ["corners 1x2", "CORNERS_1X2_FT"],
  ["cards 1x2", "CARDS_1X2_FT"],
  ["corners asian handicap", "CORNERS_HANDICAP_ASIAN"],
  ["home corners over/under", "CORNERS_TEAM_OU_HOME_FT"],
  ["away corners over/under", "CORNERS_TEAM_OU_AWAY_FT"],
  ["cards asian handicap", "CARDS_ASIAN_HANDICAP"],
  ["cards european handicap", "CARDS_HANDICAP_EUROPEAN"],
  ["home team total cards", "CARDS_TEAM_TOTAL_HOME"],
  ["away team total cards", "CARDS_TEAM_TOTAL_AWAY"],
  // Stream 3 — offsides / fouls / saves / shots (exact odds/bets names)
  ["offsides total", "OFFSIDES_OVER_UNDER"],
  ["offsides 1x2", "OFFSIDES_1X2"],
  ["offsides home total", "OFFSIDES_TEAM_HOME"],
  ["offsides away total", "OFFSIDES_TEAM_AWAY"],
  ["offsides handicap", "OFFSIDES_HANDICAP"],
  ["offsides odd/even", "OFFSIDES_ODD_EVEN"],
  ["fouls. total", "FOULS_OVER_UNDER"],
  ["fouls. 1x2", "FOULS_1X2"],
  ["fouls. home total", "FOULS_TEAM_HOME"],
  ["fouls. away total", "FOULS_TEAM_AWAY"],
  ["fouls. handicap", "FOULS_HANDICAP"],
  ["fouls. odd/even", "FOULS_ODD_EVEN"],
  ["saves total", "SAVES_OVER_UNDER"],
  ["goalkeeper saves", "SAVES_OVER_UNDER"],
  ["saves 1x2", "SAVES_1X2"],
  ["saves o/u home", "SAVES_TEAM_HOME"],
  ["saves o/u away", "SAVES_TEAM_AWAY"],
  ["home goalkeeper saves", "SAVES_TEAM_HOME"],
  ["away goalkeeper saves", "SAVES_TEAM_AWAY"],
  ["saves asian h", "SAVES_HANDICAP"],
  ["saves odd/even", "SAVES_ODD_EVEN"],
  ["total shots", "SHOTS_OVER_UNDER"],
  ["home shots on target", "SHOTS_ON_TARGET_TEAM_HOME"],
  ["away shots on target", "SHOTS_ON_TARGET_TEAM_AWAY"],
  // Combination markets (AND of two outcomes — popular for accumulators)
  ["result/total goals", "RESULT_TOTAL_FT"],
  ["total goals/both teams to score", "TOTAL_GOALS_BTTS"],
  ["results/both teams score", "RESULT_BTTS_FT"],
  ["result/both teams score", "RESULT_BTTS_FT"],
  ["win to nil", "WIN_TO_NIL"],

  // --- LIVE odds/live/bets display names (Tier E) ---
  // Mapped to the SAME canonical graders; only names whose SCOPE exactly matches
  // the grader (full-match result/goals/total-corners/total-cards). Team-scoped
  // corner totals, yellow/red-only cards, goalscorer (playerId), and all
  // period/ET/Nth variants are deliberately EXCLUDED (they'd mis-scope or VOID)
  // and remain hidden via no-map-entry + the mappingMismatch guard.
  ["match corners", "CORNERS_OVER_UNDER"],
  ["total corners", "CORNERS_OVER_UNDER"],
  ["asian corners", "CORNERS_OVER_UNDER"],
  ["3-way handicap", "HANDICAP_ASIAN"],
  ["goals odd/even", "ODD_EVEN"],
  ["away team goals", "TEAM_TOTAL_AWAY"],
  ["home team goals", "TEAM_TOTAL_HOME"],
  ["total cards", "CARDS_OVER_UNDER"],
]);

/**
 * Resolve a provider DISPLAY name to a canonical code (allowed markets only).
 * Returns null for names we don't expose. Exact, lowercase match — deliberately
 * conservative so a stat/period-qualified name ("Yellow Double Chance",
 * "Goals Over/Under First Half") does NOT match the base entry.
 */
export function resolveProviderMarketName(name) {
  const key = String(name || "").toLowerCase().trim();
  return PROVIDER_NAME_TO_CODE.get(key) || null;
}

/**
 * Is this provider market NAME allowed to be served/rendered in the active phase?
 * A name is allowed only if it maps to a canonical code, that code has a real
 * grader, the name↔code mapping is consistent, and the code is in the phase set.
 */
export function isProviderMarketNameAllowed(name) {
  const code = resolveProviderMarketName(name);
  if (!code) return false;
  if (mappingMismatch(name, code)) return false;
  if (!hasRealGrader(code)) return false;
  return isCodeAllowed(code);
}

function hasStatQualifier(name) {
  return /yellow|card|corner|offside|foul|save|shot|book|tackle|passes|penalt|\bred\b/i.test(name);
}
function isPeriodCode(c) {
  // HALVES (e.g. WIN_BOTH_HALVES) is half-scoped too — without it the code reads
  // as full-match and its legitimate "…halves" name is flagged a period mis-map.
  return /(^|_)(HT|SH)(_|$)|HALF|HALVES|EXTRA|PENALT|WINDOW|10MIN/.test(c);
}
function hasPeriodQualifier(name) {
  return /half|halves|1st set|2nd set|\(set|sets\)|extra time|\(et\)|shootout|penalt|interval|minute| m\b|between|0 and 10|\d+m-\d+m|race to|highest scoring/i.test(name);
}
// genuine compound after stripping atomic "/" market tokens.
function isCompoundName(name) {
  const n = String(name || "")
    .toLowerCase()
    .replace(/over\/under/g, "ou")
    .replace(/odd\/even/g, "oe")
    .replace(/home\/away/g, "ha")
    .replace(/ht\/ft/g, "htft")
    .replace(/half time\/full time/g, "htft");
  return n.includes("/");
}

/**
 * Detect a provider-name ↔ canonical-code mismatch that would settle WRONG.
 * Returns a reason string or "".
 */
export function mappingMismatch(name, code) {
  if (!code || !name) return "";
  const c = norm(code);
  if (isCompoundName(name) && BASE_GOALS_CODES.has(c))
    return "compound_market_single_code";
  if (BASE_GOALS_CODES.has(c) && hasStatQualifier(name))
    return "stat_name_on_goals_code";
  const isFullMatchGrader = REAL_GRADER_CODES.has(c) && !isPeriodCode(c);
  if (isFullMatchGrader && hasPeriodQualifier(name))
    return "period_name_on_fullmatch_code";
  return "";
}

/** True iff the canonical code has a real settlement grader. */
export function hasRealGrader(code) {
  const c = norm(code);
  if (!c || !REAL_GRADER_CODES.has(c)) return false;
  const mod = MARKET_REGISTRY.get(c);
  if (!mod) return false;
  // A registered module is a REAL grader if it is either a core module (its
  // description is not the catalog placeholder) OR a catalog code with an
  // explicit reg() handler. Catalog auto-modules WITHOUT a handler fall through
  // to the VOID default and are not real graders.
  const isCatalogPlaceholder = /API-Sports catalogue market/i.test(
    String(mod.description || ""),
  );
  if (!isCatalogPlaceholder) return true;
  return catalogHasHandler(c);
}

/**
 * Resolve + validate + gate a selection.
 *
 * @param {{ marketCode?, marketLabel?, selection?, label?, marketParams? }} input
 * @param {{ mode?: "strict"|"lenient" }} [opts]
 *   strict  = public/prebook: all four checks incl. allowlist.
 *   lenient = cashier admin-Match: checks 1–3 only (no feed allowlist).
 * @returns {{ ok: boolean, code: string|null, params: object|null, reason: string|null }}
 */
export function classifySelectionSupport(input = {}, opts = {}) {
  const mode = opts.mode === "lenient" ? "lenient" : "strict";
  const name =
    String(input.marketLabel || "").trim() ||
    String(input.selection || input.label || "").trim();

  // 1. resolve canonical code
  const code =
    // Resolve from the MARKET-identifying fields first (code, then market name),
    // and ONLY then fall back to the selection/label VALUE. Value labels like
    // "1" / "3" collide with bet ids (1→MATCH_WINNER, 3→SECOND_HALF_RESULT), so
    // resolving the value before the market name would mis-route the leg.
    MARKET_REGISTRY.resolveCode(input.marketCode) ||
    MARKET_REGISTRY.resolveCode(input.marketLabel) ||
    // Provider DISPLAY name → code (the odds feed / frontend send the market
    // NAME, not a canonical code or alias). Lets a leg placed with just
    // {marketLabel, label} resolve, with params re-derived from the label.
    resolveProviderMarketName(input.marketLabel) ||
    MARKET_REGISTRY.resolveCode(input.selection) ||
    MARKET_REGISTRY.resolveCode(input.label) ||
    resolveProviderMarketName(input.selection);
  if (!code) {
    return { ok: false, code: null, params: null, reason: "unresolvable_market" };
  }

  // 2. name ↔ code consistency (blocks the 13 mis-mapped markets)
  const mismatch = mappingMismatch(name, code);
  if (mismatch) {
    return { ok: false, code, params: null, reason: `mapping_mismatch:${mismatch}` };
  }

  // 3. real grader present
  if (!hasRealGrader(code)) {
    return { ok: false, code, params: null, reason: "no_settlement_handler" };
  }

  // 4. allowlist (strict only)
  if (mode === "strict" && !isCodeAllowed(code)) {
    return { ok: false, code, params: null, reason: "market_not_allowed" };
  }

  // validate + derive params via the module (may throw ValidationError)
  let params;
  try {
    const base =
      input.marketParams && typeof input.marketParams === "object"
        ? { ...input.marketParams }
        : {};
    params = MARKET_REGISTRY.validate(code, base, {
      label: input.label ?? input.selection ?? "",
    });
  } catch (err) {
    if (err instanceof MarketUnknownError) {
      return { ok: false, code, params: null, reason: "no_settlement_handler" };
    }
    return {
      ok: false,
      code,
      params: null,
      reason: `invalid_params:${err?.code || "validation"}`,
    };
  }

  return { ok: true, code, params, reason: null };
}
