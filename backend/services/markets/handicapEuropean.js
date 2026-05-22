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

function normalizeHandicap(raw) {
  // European handicap is a 3-way market on integer handicaps only.
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  return n;
}

function winnerFor(home, away) {
  if (home > away) return "HOME";
  if (home < away) return "AWAY";
  return "DRAW";
}

export default Object.freeze({
  code: "HANDICAP_EUROPEAN",
  version: 1,
  aliases: ["EUROPEAN_HANDICAP", "EH", "3WAY_HANDICAP"],
  description: "European 3-way handicap (integer handicap, includes draw)",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "NONE",
  },

  validate(params) {
    const side = normalizeSide(params?.side);
    if (!side) throw new ValidationError("invalid_side", { field: "side" });
    const handicap = normalizeHandicap(params?.handicap ?? params?.line ?? params?.value);
    if (handicap === null) throw new ValidationError("invalid_handicap", { field: "handicap" });
    // appliedTo tells us which team the handicap is applied to. If not
    // given, default to HOME per convention.
    const appliedToRaw = String(params?.appliedTo || "HOME").toUpperCase();
    const appliedTo = appliedToRaw === "AWAY" ? "AWAY" : "HOME";
    return { side, handicap, appliedTo };
  },

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const side = normalizeSide(selection?.market_params?.side);
    const handicap = normalizeHandicap(selection?.market_params?.handicap);
    const appliedTo = selection?.market_params?.appliedTo === "AWAY" ? "AWAY" : "HOME";
    if (!side || handicap === null) {
      return { result: "VOID", reason: "invalid_selection_params" };
    }
    let home = mr.scores.fullTime.home;
    let away = mr.scores.fullTime.away;
    if (appliedTo === "HOME") home += handicap;
    else away += handicap;
    const winner = winnerFor(home, away);
    return { result: side === winner ? "WON" : "LOST" };
  },
});
