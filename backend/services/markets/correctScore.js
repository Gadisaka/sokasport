import { ValidationError } from "./errors.js";

const MAX_SCORE = 15;

function toScore(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_SCORE) return null;
  return n;
}

export default Object.freeze({
  code: "CORRECT_SCORE",
  version: 1,
  aliases: ["EXACT_SCORE"],
  description: "Exact full-time scoreline",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "NONE",
  },

  validate(params) {
    const home = toScore(params?.home);
    const away = toScore(params?.away);
    if (home === null) throw new ValidationError("invalid_home", { field: "home" });
    if (away === null) throw new ValidationError("invalid_away", { field: "away" });
    return { home, away };
  },

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const { home: expH, away: expA } = selection?.market_params || {};
    if (expH == null || expA == null) {
      return { result: "VOID", reason: "invalid_selection_score" };
    }
    const ft = mr.scores.fullTime;
    const won = ft.home === Number(expH) && ft.away === Number(expA);
    return { result: won ? "WON" : "LOST" };
  },
});
