import { ValidationError } from "./errors.js";

const SIDES = new Set(["HOME", "DRAW", "AWAY"]);
const SIDE_ALIASES = new Map([
  ["1", "HOME"], ["H", "HOME"], ["HOME", "HOME"],
  ["X", "DRAW"], ["D", "DRAW"], ["DRAW", "DRAW"],
  ["2", "AWAY"], ["A", "AWAY"], ["AWAY", "AWAY"],
]);

function normalizeSide(raw) {
  if (raw === null || raw === undefined) return null;
  const key = String(raw).trim().toUpperCase();
  return SIDE_ALIASES.get(key) || null;
}

function pickWinner(ft) {
  if (ft.home > ft.away) return "HOME";
  if (ft.home < ft.away) return "AWAY";
  return "DRAW";
}

export default Object.freeze({
  code: "MATCH_WINNER",
  version: 1,
  aliases: ["1X2", "MATCH_RESULT", "FT_RESULT", "WINNER"],
  description: "Full-time 1X2 result",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "NONE",
  },

  validate(params, ctx) {
    const raw = params?.side ?? ctx?.label;
    const side = normalizeSide(raw);
    if (!side || !SIDES.has(side)) {
      throw new ValidationError("invalid_side", { field: "side", details: { raw } });
    }
    return { side };
  },

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const expected = normalizeSide(selection?.market_params?.side);
    if (!expected) return { result: "VOID", reason: "invalid_selection_side" };

    // Admin-managed Match path: when scores are absent but a resultLabel
    // exists (e.g. "1", "Home"), grade against the label.
    const ft = mr.scores.fullTime;
    if (!Number.isInteger(ft.home) || !Number.isInteger(ft.away)) {
      const labelSide = normalizeSide(mr.resultLabel);
      if (labelSide) {
        return { result: expected === labelSide ? "WON" : "LOST" };
      }
      // canEvaluate should have caught this; defensive VOID.
      return { result: "VOID", reason: "missing_scores" };
    }

    const winner = pickWinner(ft);
    return { result: expected === winner ? "WON" : "LOST" };
  },
});
