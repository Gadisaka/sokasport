/**
 * Emits one `MarketModule` per API-Sports canonical code that is not part of the
 * original core registry (MATCH_WINNER, OVER_UNDER, …).
 *
 * @module services/markets/apiSportsCatalogModules
 */
import { API_SPORTS_CANONICAL_CODES } from "./apiSportsBetIdMap.generated.js";
import {
  catalogValidate,
  catalogCanEvaluate,
  catalogEvaluate,
  defaultSettlePolicy,
} from "./apiSportsCatalogHandlers.js";

const CORE_CODES = new Set([
  "MATCH_WINNER",
  "DOUBLE_CHANCE",
  "DRAW_NO_BET",
  "OVER_UNDER",
  "BTTS",
  "ODD_EVEN",
  "CORRECT_SCORE",
  "WINNING_MARGIN",
  "HALF_TIME_RESULT",
  "HT_OVER_UNDER",
  "HT_FT",
  "TEAM_TOTAL",
  "HANDICAP_ASIAN",
  "HANDICAP_EUROPEAN",
  "GOALSCORER_ANYTIME",
  "FIRST_GOALSCORER",
  "LAST_GOALSCORER",
  "CARDS_OVER_UNDER",
  "CORNERS_OVER_UNDER",
  "PLAYER_CARDS",
  "PLAYER_SHOTS",
  "HOME_AWAY",
]);

function buildModule(code) {
  return Object.freeze({
    code,
    version: 1,
    aliases: [],
    description: `API-Sports catalogue market (${code})`,
    requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
    settlePolicy: defaultSettlePolicy,
    validate: (params, ctx) => catalogValidate(code, params, ctx),
    canEvaluate: (mr) => catalogCanEvaluate(code, mr),
    evaluate: (sel, mr) => catalogEvaluate(code, sel, mr),
  });
}

export const API_SPORTS_CATALOG_MODULES = Object.freeze(
  API_SPORTS_CANONICAL_CODES.filter((c) => !CORE_CODES.has(c)).map((c) =>
    buildModule(c),
  ),
);
