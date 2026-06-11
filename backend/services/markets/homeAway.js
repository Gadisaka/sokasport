/**
 * Match Winner style markets without DRAW — stake refunded on draw (2-way).
 * API-Sports bet id 2 ("Home/Away").
 */
import { ValidationError } from "./errors.js";
import { resolveParamsViaValidate } from "./_resolveParams.js";

const SIDE_ALIASES = new Map([
  ["1", "HOME"], ["H", "HOME"], ["HOME", "HOME"],
  ["2", "AWAY"], ["A", "AWAY"], ["AWAY", "AWAY"],
]);

function normalizeSide(raw) {
  const key = String(raw || "").trim().toUpperCase();
  return SIDE_ALIASES.get(key) || null;
}

function validate(params, ctx) {
  const side = normalizeSide(params?.side ?? ctx?.label);
  if (!side) throw new ValidationError("invalid_side", { field: "side" });
  return { side };
}

export default Object.freeze({
  code: "HOME_AWAY",
  version: 1,
  aliases: ["HOME_AWAY_2WAY", "MONEYLINE_2WAY"],
  description: "Home / Away — void stake on draw",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "VOID",
  },

  validate,

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const params = resolveParamsViaValidate(selection, validate);
    const expected = params?.side;
    if (!expected) return { result: "VOID", reason: "invalid_selection_side" };
    const { home, away } = mr.scores.fullTime;
    if (home === away) return { result: "VOID", reason: "draw_refund" };
    const winner = home > away ? "HOME" : "AWAY";
    return { result: expected === winner ? "WON" : "LOST" };
  },
});
