/**
 * Market Evaluator V2 — deterministic grading engine.
 *
 * Pure function of `(selection, matchResult)`. No I/O. No clock. No RNG.
 *
 * Contract (non-negotiable):
 *   - Returns `PENDING` ONLY when `matchResult.finality === "PENDING"`.
 *   - Returns `WON | LOST | VOID` for every other case.
 *   - Attaches `engineVersion` and `marketVersion` to every outcome.
 *   - Swallows module exceptions as `VOID / module_error:<code>` so a
 *     buggy market handler can never leak a stack trace into the
 *     settlement transaction.
 *
 * The engine owns zero per-market knowledge — everything lives in the
 * `MARKET_REGISTRY` modules. Adding a market never touches this file.
 *
 * @module services/marketEvaluatorV2
 */

import { MARKET_REGISTRY } from "./markets/registry.js";

/** Bumped when the engine's own universal rules change. */
export const ENGINE_VERSION = 2;

export const SELECTION_RESULT = Object.freeze({
  PENDING: "PENDING",
  WON: "WON",
  LOST: "LOST",
  VOID: "VOID",
});

const VALID_TERMINAL_RESULTS = new Set(["WON", "LOST", "VOID"]);

function meta(result, reason, marketVersion = 0) {
  return {
    result,
    reason: String(reason || "ok"),
    engineVersion: ENGINE_VERSION,
    marketVersion: Number.isFinite(marketVersion) ? marketVersion : 0,
  };
}

function hasFullTimeScores(mr) {
  return (
    Number.isInteger(mr?.scores?.fullTime?.home) &&
    Number.isInteger(mr?.scores?.fullTime?.away)
  );
}

/**
 * Evaluate a single selection against a normalized match result.
 *
 * Guards, in strict order:
 *   1. missing selection
 *   2. missing matchResult
 *   3. selection.market_code empty / null
 *   4. code not registered
 *   5. matchResult.finality === "PENDING" → PENDING (the only one)
 *   6. matchResult.finality === "VOID" → VOID / match_voided
 *   7. AWARDED && policy.voidOnAwardedWithoutScores && no scores → VOID
 *   8. !module.canEvaluate(mr) → VOID / missing_required_data
 *   9. module throws → VOID / module_error:<code>
 *  10. module returns non-terminal / malformed → VOID / module_contract_violation
 *
 * @param {object|null} selection
 * @param {object|null} matchResult
 * @returns {{ result: string, reason: string, engineVersion: number, marketVersion: number }}
 */
export function evaluateSelection(selection, matchResult) {
  if (!selection) return meta(SELECTION_RESULT.VOID, "missing_selection");
  if (!matchResult) return meta(SELECTION_RESULT.VOID, "missing_match_result");

  const code = String(selection.market_code || "").toUpperCase().trim();
  if (!code) return meta(SELECTION_RESULT.VOID, "legacy_unmapped");

  const module = MARKET_REGISTRY.get(code);
  if (!module) return meta(SELECTION_RESULT.VOID, "unknown_market");

  const finality = String(matchResult.finality || "").toUpperCase();
  switch (finality) {
    case "VOID":
      return meta(SELECTION_RESULT.VOID, "match_voided", module.version);
    case "PENDING":
      return meta(SELECTION_RESULT.PENDING, "match_not_finalized", module.version);
    case "FINAL":
    case "AWARDED":
      break;
    default:
      // Unknown finality on a non-PENDING match is treated as a data
      // error so we never silently settle on bad input.
      return meta(SELECTION_RESULT.VOID, "unknown_finality", module.version);
  }

  if (
    finality === "AWARDED" &&
    module.settlePolicy?.voidOnAwardedWithoutScores !== false &&
    !hasFullTimeScores(matchResult)
  ) {
    return meta(SELECTION_RESULT.VOID, "awarded_without_scores", module.version);
  }

  let canEval;
  try {
    canEval = Boolean(module.canEvaluate(matchResult));
  } catch (err) {
    return meta(
      SELECTION_RESULT.VOID,
      `module_error:${err?.code || "can_evaluate_threw"}`,
      module.version,
    );
  }
  if (!canEval) {
    return meta(SELECTION_RESULT.VOID, "missing_required_data", module.version);
  }

  let outcome;
  try {
    outcome = module.evaluate(selection, matchResult);
  } catch (err) {
    return meta(
      SELECTION_RESULT.VOID,
      `module_error:${err?.code || "evaluate_threw"}`,
      module.version,
    );
  }

  if (!outcome || typeof outcome !== "object") {
    return meta(
      SELECTION_RESULT.VOID,
      "module_contract_violation",
      module.version,
    );
  }
  if (!VALID_TERMINAL_RESULTS.has(outcome.result)) {
    return meta(
      SELECTION_RESULT.VOID,
      "module_contract_violation",
      module.version,
    );
  }

  return {
    result: outcome.result,
    reason: String(outcome.reason || "ok"),
    engineVersion: ENGINE_VERSION,
    marketVersion: module.version,
  };
}
