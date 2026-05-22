import { ValidationError } from "./errors.js";

const SIDE_ALIASES = new Map([
  ["1", "HOME"], ["H", "HOME"], ["HOME", "HOME"],
  ["2", "AWAY"], ["A", "AWAY"], ["AWAY", "AWAY"],
]);

function normalizeSide(raw) {
  const key = String(raw || "").trim().toUpperCase();
  return SIDE_ALIASES.get(key) || null;
}

function pickWinner(ft) {
  if (ft.home > ft.away) return "HOME";
  if (ft.home < ft.away) return "AWAY";
  return "DRAW";
}

export default Object.freeze({
  code: "DRAW_NO_BET",
  version: 1,
  aliases: ["DNB"],
  description: "Home / Away. Stake refunded on draw.",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "VOID",
  },

  validate(params, ctx) {
    const side = normalizeSide(params?.side ?? ctx?.label);
    if (!side) {
      throw new ValidationError("invalid_side", { field: "side" });
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
    const winner = pickWinner(mr.scores.fullTime);
    if (winner === "DRAW") return { result: "VOID", reason: "draw_refund" };
    return { result: expected === winner ? "WON" : "LOST" };
  },
});
