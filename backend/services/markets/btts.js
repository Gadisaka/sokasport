import { ValidationError } from "./errors.js";

function normalizePick(raw) {
  const key = String(raw || "").trim().toUpperCase();
  if (key === "YES" || key === "Y") return "YES";
  if (key === "NO" || key === "N") return "NO";
  return null;
}

export default Object.freeze({
  code: "BTTS",
  version: 1,
  aliases: ["BOTH_TEAMS_TO_SCORE", "GG_NG"],
  description: "Both teams to score (Yes / No)",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "NONE",
  },

  validate(params, ctx) {
    const pick = normalizePick(params?.pick ?? params?.side ?? ctx?.label);
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
    const { home, away } = mr.scores.fullTime;
    const both = home > 0 && away > 0;
    const won = (pick === "YES") === both;
    return { result: won ? "WON" : "LOST" };
  },
});
