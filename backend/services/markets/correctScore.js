import { ValidationError } from "./errors.js";
import { resolveParamsViaValidate } from "./_resolveParams.js";

const MAX_SCORE = 15;

function toScore(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_SCORE) return null;
  return n;
}

// Parse a scoreline label like "2-1" / "2:1" / "2 - 1" → { home, away }.
function parseLabel(label) {
  const m = /^\s*(\d{1,2})\s*[-:]\s*(\d{1,2})\s*$/.exec(String(label || ""));
  if (!m) return { home: null, away: null };
  return { home: toScore(m[1]), away: toScore(m[2]) };
}

function validate(params, ctx) {
  const fromLabel = parseLabel(ctx?.label);
  const home = toScore(params?.home) ?? fromLabel.home;
  const away = toScore(params?.away) ?? fromLabel.away;
  if (home === null) throw new ValidationError("invalid_home", { field: "home" });
  if (away === null) throw new ValidationError("invalid_away", { field: "away" });
  return { home, away };
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

  validate,

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const params = resolveParamsViaValidate(selection, validate);
    if (params == null || params.home == null || params.away == null) {
      return { result: "VOID", reason: "invalid_selection_score" };
    }
    const ft = mr.scores.fullTime;
    const won = ft.home === params.home && ft.away === params.away;
    return { result: won ? "WON" : "LOST" };
  },
});
