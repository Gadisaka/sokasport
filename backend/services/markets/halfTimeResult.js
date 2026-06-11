import { ValidationError } from "./errors.js";
import { resolveParamsViaValidate } from "./_resolveParams.js";

const SIDE_ALIASES = new Map([
  ["1", "HOME"], ["H", "HOME"], ["HOME", "HOME"],
  ["X", "DRAW"], ["D", "DRAW"], ["DRAW", "DRAW"],
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
  code: "HALF_TIME_RESULT",
  version: 1,
  aliases: ["HT_RESULT", "HT_1X2", "1X2_HALFTIME"],
  description: "Half-time 1X2 result",
  requiredResultFields: ["scores.halfTime.home", "scores.halfTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "NONE",
  },

  validate,

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.halfTime?.home) &&
      Number.isInteger(mr?.scores?.halfTime?.away)
    );
  },

  evaluate(selection, mr) {
    const params = resolveParamsViaValidate(selection, validate);
    const side = params?.side;
    if (!side) return { result: "VOID", reason: "invalid_selection_side" };
    const { home, away } = mr.scores.halfTime;
    const winner = home > away ? "HOME" : home < away ? "AWAY" : "DRAW";
    return { result: side === winner ? "WON" : "LOST" };
  },
});
