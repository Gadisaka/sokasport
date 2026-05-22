import { ValidationError } from "./errors.js";

const SIDE_ALIASES = new Map([
  ["1", "HOME"], ["H", "HOME"], ["HOME", "HOME"],
  ["X", "DRAW"], ["D", "DRAW"], ["DRAW", "DRAW"],
  ["2", "AWAY"], ["A", "AWAY"], ["AWAY", "AWAY"],
]);

function normalizeSide(raw) {
  const key = String(raw || "").trim().toUpperCase();
  return SIDE_ALIASES.get(key) || null;
}

function winnerFor(home, away) {
  if (home > away) return "HOME";
  if (home < away) return "AWAY";
  return "DRAW";
}

export default Object.freeze({
  code: "HT_FT",
  version: 1,
  aliases: ["HALFTIME_FULLTIME", "HT/FT"],
  description: "Half-time / Full-time combination",
  requiredResultFields: [
    "scores.halfTime.home",
    "scores.halfTime.away",
    "scores.fullTime.home",
    "scores.fullTime.away",
  ],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "NONE",
  },

  validate(params) {
    const ht = normalizeSide(params?.ht);
    const ft = normalizeSide(params?.ft);
    if (!ht) throw new ValidationError("invalid_ht", { field: "ht" });
    if (!ft) throw new ValidationError("invalid_ft", { field: "ft" });
    return { ht, ft };
  },

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.halfTime?.home) &&
      Number.isInteger(mr?.scores?.halfTime?.away) &&
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const ht = normalizeSide(selection?.market_params?.ht);
    const ft = normalizeSide(selection?.market_params?.ft);
    if (!ht || !ft) return { result: "VOID", reason: "invalid_selection" };
    const htWinner = winnerFor(mr.scores.halfTime.home, mr.scores.halfTime.away);
    const ftWinner = winnerFor(mr.scores.fullTime.home, mr.scores.fullTime.away);
    const won = ht === htWinner && ft === ftWinner;
    return { result: won ? "WON" : "LOST" };
  },
});
