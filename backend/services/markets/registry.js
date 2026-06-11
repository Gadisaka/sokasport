/**
 * Market Registry — Market Evaluator V2.
 *
 * Single source of truth mapping canonical `market_code` → module. All
 * modules live in `backend/services/markets/` and are imported here.
 *
 * Registration rules (enforced at module load):
 *   1. Every module must have a unique `code`.
 *   2. Every module must expose the full `MarketModule` interface
 *      (`code`, `version`, `settlePolicy`, `validate`, `canEvaluate`,
 *      `evaluate`). We fail FAST at boot if anything is missing.
 *   3. Aliases are resolved case-insensitively for placement time only.
 *      At settlement time the engine consults `get(code)` directly and
 *      never re-resolves.
 *
 * Adding a market:
 *   - drop a new file under `services/markets/`
 *   - add one import here + one entry in `MODULES`
 *   - write tests in `tests/markets/<name>.test.js`
 *
 * @module services/markets/registry
 */

import { MarketUnknownError } from "./errors.js";

import { tryResolveMarketCodeBetId } from "./apiSportsBetIdMap.js";
import { API_SPORTS_CATALOG_MODULES } from "./apiSportsCatalogModules.js";
import {
  catalogHandlerCodes,
  catalogValidate,
  catalogCanEvaluate,
  catalogEvaluate,
  defaultSettlePolicy,
} from "./apiSportsCatalogHandlers.js";

import matchWinner from "./matchWinner.js";
import doubleChance from "./doubleChance.js";
import drawNoBet from "./drawNoBet.js";
import overUnder from "./overUnder.js";
import btts from "./btts.js";
import oddEven from "./oddEven.js";
import correctScore from "./correctScore.js";
import winningMargin from "./winningMargin.js";
import halfTimeResult from "./halfTimeResult.js";
import htOverUnder from "./htOverUnder.js";
import htFt from "./htFt.js";
import teamTotal from "./teamTotal.js";
import handicapAsian from "./handicapAsian.js";
import handicapEuropean from "./handicapEuropean.js";
import goalscorerAnytime from "./goalscorerAnytime.js";
import firstGoalscorer from "./firstGoalscorer.js";
import lastGoalscorer from "./lastGoalscorer.js";
import cardsOverUnder from "./cardsOverUnder.js";
import cornersOverUnder from "./cornersOverUnder.js";
import playerCards from "./playerCards.js";
import playerShots from "./playerShots.js";
import homeAway from "./homeAway.js";

const ALL_MODULES = [
  matchWinner,
  doubleChance,
  drawNoBet,
  homeAway,
  overUnder,
  btts,
  oddEven,
  correctScore,
  winningMargin,
  halfTimeResult,
  htOverUnder,
  htFt,
  teamTotal,
  handicapAsian,
  handicapEuropean,
  goalscorerAnytime,
  firstGoalscorer,
  lastGoalscorer,
  cardsOverUnder,
  cornersOverUnder,
  playerCards,
  playerShots,
  ...API_SPORTS_CATALOG_MODULES,
];

function normalize(code) {
  return String(code || "").toUpperCase().trim();
}

function assertInterface(m) {
  const required = ["code", "version", "settlePolicy", "validate", "canEvaluate", "evaluate"];
  for (const key of required) {
    if (!(key in m)) {
      throw new Error(
        `[markets/registry] module is missing required field "${key}": ${JSON.stringify(m)}`,
      );
    }
  }
  if (typeof m.validate !== "function") {
    throw new Error(`[markets/registry] "${m.code}".validate must be a function`);
  }
  if (typeof m.canEvaluate !== "function") {
    throw new Error(`[markets/registry] "${m.code}".canEvaluate must be a function`);
  }
  if (typeof m.evaluate !== "function") {
    throw new Error(`[markets/registry] "${m.code}".evaluate must be a function`);
  }
}

const MODULES = Object.create(null);
const ALIAS_INDEX = Object.create(null);

for (const mod of ALL_MODULES) {
  assertInterface(mod);
  const code = normalize(mod.code);
  if (MODULES[code]) {
    throw new Error(
      `[markets/registry] duplicate market code "${code}" in ${mod.description || mod.code}`,
    );
  }
  MODULES[code] = mod;
  // Canonical code is always its own alias so `resolveCode("MATCH_WINNER")` works.
  ALIAS_INDEX[code] = code;
  for (const raw of mod.aliases || []) {
    const alias = normalize(raw);
    if (!alias) continue;
    if (ALIAS_INDEX[alias] && ALIAS_INDEX[alias] !== code) {
      throw new Error(
        `[markets/registry] alias "${alias}" maps to both "${ALIAS_INDEX[alias]}" and "${code}"`,
      );
    }
    ALIAS_INDEX[alias] = code;
  }
}

// Auto-register a module for any reg() handler code that the generated module
// list (API_SPORTS_CATALOG_MODULES) does not already cover. Without this, a
// catalog handler with no matching generated module is silently unsupported
// (the registry can't route it → VOID). This closes that gap permanently: any
// code with a reg() handler is settleable.
for (const raw of catalogHandlerCodes()) {
  const code = normalize(raw);
  if (MODULES[code]) continue;
  MODULES[code] = Object.freeze({
    code,
    version: 1,
    aliases: [],
    description: "API-Sports catalogue market (auto-registered handler)",
    settlePolicy: defaultSettlePolicy,
    validate: (params, ctx) => catalogValidate(code, params, ctx),
    canEvaluate: (mr) => catalogCanEvaluate(code, mr),
    evaluate: (sel, mr) => catalogEvaluate(code, sel, mr),
  });
  ALIAS_INDEX[code] = code;
}

Object.freeze(MODULES);
Object.freeze(ALIAS_INDEX);

export const MARKET_REGISTRY = Object.freeze({
  /** @param {string} code */
  has(code) {
    return Boolean(MODULES[normalize(code)]);
  },
  /** @param {string} code */
  get(code) {
    return MODULES[normalize(code)] || null;
  },
  /** All registered modules. */
  list() {
    return Object.values(MODULES);
  },
  /** All canonical codes. */
  codes() {
    return Object.keys(MODULES);
  },
  /**
   * Alias-aware lookup used ONLY at placement time. Returns the
   * canonical code (e.g. "MATCH_WINNER") or `null` when the input
   * doesn't match any canonical code or alias.
   */
  resolveCode(input) {
    const key = normalize(input);
    if (!key) return null;
    const bet = tryResolveMarketCodeBetId(key);
    if (bet) return normalize(bet.canonical);
    return ALIAS_INDEX[key] || null;
  },
  /**
   * Placement-time validation. Throws `MarketUnknownError` when the
   * code isn't registered, or propagates the module's own
   * `ValidationError` when params are bad.
   */
  validate(code, params, ctx) {
    const module = MODULES[normalize(code)];
    if (!module) throw new MarketUnknownError(code);
    return module.validate(params, ctx || {});
  },
});

export { MarketUnknownError };
