/**
 * Market Module Template.
 *
 * **DO NOT register this file in `registry.js`.** Copy it to a new
 * file (e.g. `services/markets/myNewMarket.js`) and fill in the code.
 *
 * A market module is a frozen object that the engine consults to grade
 * one selection against a normalized `MatchResultV2`. All methods must
 * be **pure** and must not do any I/O. The engine enforces universal
 * rules (void match, missing data, etc.) BEFORE `evaluate()` is ever
 * called.
 *
 * @module services/markets/_template
 */

import { ValidationError } from "./errors.js";

const TEMPLATE_MODULE = Object.freeze({
  /**
   * Canonical uppercase code. Must be unique across the registry.
   * Persisted on `TicketSelection.market_code`.
   */
  code: "TEMPLATE_MARKET",

  /**
   * Integer, bumped whenever grading rules change in a way that would
   * produce a different result for the same input. Persisted on
   * `TicketSelection.market_version` for audit.
   */
  version: 1,

  /**
   * Optional free-form labels / legacy market names used ONLY by
   * `MARKET_REGISTRY.resolveCode()` at placement time so the frontend
   * can send human labels like "1X2" and we map them to the canonical
   * code. Never consulted at settlement time.
   */
  aliases: [],

  /** Short sentence for the admin UI. */
  description: "Short description of what this market grades.",

  /**
   * Dot-path names that MUST be present (non-null) on `MatchResultV2`
   * for grading to even be attempted. Used by the engine to short-
   * circuit to `VOID / missing_required_data` on FINAL/AWARDED matches
   * when data is missing. Also documented for ops.
   */
  requiredResultFields: [
    "scores.fullTime.home",
    "scores.fullTime.away",
  ],

  /**
   * Declarative policy the engine reads before `evaluate()` runs.
   */
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "VOID",
  },

  /**
   * Placement-time validator. Normalizes the params the FE sent into
   * the canonical shape we persist on `TicketSelection.market_params`.
   * MUST throw `ValidationError` with a machine code on any invalid
   * input. Never returns a partial object.
   *
   * @param {object} params - raw `marketParams` from the FE
   * @param {object} ctx    - `{ label, fixture, match }` helpers
   * @returns {object} canonical params (stored verbatim on the row)
   */
  validate(params, _ctx) {
    if (!params || typeof params !== "object") {
      throw new ValidationError("invalid_params");
    }
    throw new ValidationError("not_implemented");
  },

  /**
   * Runtime gate. `true` iff the match result carries enough data to
   * grade right now. Called AFTER the engine has already confirmed the
   * match is `FINAL` or `AWARDED`. Must be pure and cheap (no I/O).
   *
   * @param {MatchResultV2} _mr
   * @returns {boolean}
   */
  canEvaluate(_mr) {
    return false;
  },

  /**
   * Pure grader. Must return `{ result, reason? }` where `result` is
   * one of `"WON" | "LOST" | "VOID"`. MUST NOT return `"PENDING"`. MAY
   * throw to signal unexpected data shape — the engine wraps the call
   * in try/catch and converts exceptions into `VOID / module_error:*`.
   *
   * @param {object} selection     - persisted TicketSelection row
   * @param {MatchResultV2} matchResult
   * @returns {{ result: "WON" | "LOST" | "VOID", reason?: string }}
   */
  evaluate(_selection, _matchResult) {
    throw new Error("not_implemented");
  },
});

export default TEMPLATE_MODULE;
