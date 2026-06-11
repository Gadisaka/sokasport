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

// Parse a 3-way handicap label like "Home -1", "Draw", "Away +2", "1 (-1)" →
// { side, handicap }. `appliedTo` is NOT in the label — it defaults to HOME
// (the API-Sports "Handicap Result" convention) in validate.
function parseLabel(label) {
  const s = String(label || "").trim();
  const sideMatch = /\b(home|draw|away|h|d|a|1|x|2)\b/i.exec(s);
  const numMatch = s.match(/[-+]?\d+/);
  return {
    side: sideMatch ? normalizeSide(sideMatch[1]) : null,
    handicap: numMatch ? normalizeHandicap(numMatch[0]) : null,
  };
}

function validate(params, ctx) {
  const fromLabel = parseLabel(ctx?.label);
  const side = normalizeSide(params?.side) ?? fromLabel.side;
  if (!side) throw new ValidationError("invalid_side", { field: "side" });
  const explicit = normalizeHandicap(
    params?.handicap ?? params?.line ?? params?.value,
  );
  const handicap = explicit ?? fromLabel.handicap;
  if (handicap === null) throw new ValidationError("invalid_handicap", { field: "handicap" });
  // appliedTo tells us which team the handicap is applied to. If not
  // given (e.g. reconstructed from label), default to HOME per convention.
  const appliedToRaw = String(params?.appliedTo || "HOME").toUpperCase();
  const appliedTo = appliedToRaw === "AWAY" ? "AWAY" : "HOME";
  return { side, handicap, appliedTo };
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

  validate,

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const params = resolveParamsViaValidate(selection, validate);
    const side = params?.side;
    const handicap = params == null ? null : params.handicap;
    const appliedTo = params?.appliedTo === "AWAY" ? "AWAY" : "HOME";
    if (!side || handicap === null || handicap === undefined) {
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
