import { ValidationError } from "./errors.js";

const COMBINATIONS = new Map([
  ["1X", new Set(["HOME", "DRAW"])],
  ["HOME/DRAW", new Set(["HOME", "DRAW"])],
  ["HOME_OR_DRAW", new Set(["HOME", "DRAW"])],
  ["12", new Set(["HOME", "AWAY"])],
  ["HOME/AWAY", new Set(["HOME", "AWAY"])],
  ["HOME_OR_AWAY", new Set(["HOME", "AWAY"])],
  ["X2", new Set(["DRAW", "AWAY"])],
  ["DRAW/AWAY", new Set(["DRAW", "AWAY"])],
  ["DRAW_OR_AWAY", new Set(["DRAW", "AWAY"])],
]);

function normalize(raw) {
  return String(raw || "").trim().toUpperCase();
}

function pickWinner(ft) {
  if (ft.home > ft.away) return "HOME";
  if (ft.home < ft.away) return "AWAY";
  return "DRAW";
}

export default Object.freeze({
  code: "DOUBLE_CHANCE",
  version: 1,
  aliases: ["DC", "DOUBLE_CHANCE_FT"],
  description: "Full-time double chance (1X / 12 / X2)",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "NONE",
  },

  validate(params, ctx) {
    const raw = params?.combination ?? params?.side ?? ctx?.label;
    const key = normalize(raw);
    if (!COMBINATIONS.has(key)) {
      throw new ValidationError("invalid_combination", {
        field: "combination",
        details: { raw },
      });
    }
    // Canonical form: one of "1X" | "12" | "X2" for easy storage.
    const canonical = key === "HOME/DRAW" || key === "HOME_OR_DRAW"
      ? "1X"
      : key === "HOME/AWAY" || key === "HOME_OR_AWAY"
        ? "12"
        : key === "DRAW/AWAY" || key === "DRAW_OR_AWAY"
          ? "X2"
          : key;
    return { combination: canonical };
  },

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const key = normalize(selection?.market_params?.combination);
    const accepted = COMBINATIONS.get(key);
    if (!accepted) {
      return { result: "VOID", reason: "invalid_selection_combination" };
    }
    const winner = pickWinner(mr.scores.fullTime);
    return { result: accepted.has(winner) ? "WON" : "LOST" };
  },
});
