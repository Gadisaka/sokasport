import { ValidationError } from "./errors.js";

function normalizePick(raw) {
  const key = String(raw || "").trim().toUpperCase();
  if (key === "ODD") return "ODD";
  if (key === "EVEN") return "EVEN";
  return null;
}

export default Object.freeze({
  code: "ODD_EVEN",
  version: 1,
  aliases: ["PARITY", "ODD_OR_EVEN"],
  description: "Parity of full-time total goals",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "NONE",
  },

  validate(params, ctx) {
    const pick = normalizePick(params?.pick ?? ctx?.label);
    if (!pick) throw new ValidationError("invalid_pick", { field: "pick" });
    return { pick };
  },

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const pick = normalizePick(selection?.market_params?.pick);
    if (!pick) return { result: "VOID", reason: "invalid_selection_pick" };
    const total = mr.scores.fullTime.home + mr.scores.fullTime.away;
    const isEven = total % 2 === 0;
    const won = (pick === "EVEN") === isEven;
    return { result: won ? "WON" : "LOST" };
  },
});
