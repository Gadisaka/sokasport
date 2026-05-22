import { ValidationError } from "./errors.js";

function normalizeSide(raw) {
  const key = String(raw || "").trim().toUpperCase();
  if (key === "OVER" || key === "O") return "OVER";
  if (key === "UNDER" || key === "U") return "UNDER";
  return null;
}

function normalizeLine(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Allow 0.0, 0.5, 1.0, 1.25, 1.5, 1.75, 2.0 … — i.e. 0.25 step.
  const scaled = Math.round(n * 4);
  if (Math.abs(n * 4 - scaled) > 1e-9) return null;
  return scaled / 4;
}

export default Object.freeze({
  code: "OVER_UNDER",
  version: 1,
  aliases: ["GOALS_OVER_UNDER", "TOTALS", "MATCH_TOTAL"],
  description: "Full-time match total goals",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "VOID",
  },

  validate(params) {
    const side = normalizeSide(params?.side);
    if (!side) throw new ValidationError("invalid_side", { field: "side" });
    const line = normalizeLine(params?.line ?? params?.handicap ?? params?.value);
    if (line === null || line < 0) {
      throw new ValidationError("invalid_line", { field: "line" });
    }
    return { side, line };
  },

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const side = normalizeSide(selection?.market_params?.side);
    const line = normalizeLine(selection?.market_params?.line);
    if (!side || line === null) {
      return { result: "VOID", reason: "invalid_selection_params" };
    }
    const total = mr.scores.fullTime.home + mr.scores.fullTime.away;

    // Quarter lines: split into two halves mathematically.
    // 0.25 step that is not a halfway point → half-win / half-loss,
    // which the engine models as VOID (push) on half and WON/LOST on
    // the other. Because we settle money at leg granularity in this
    // system, we approximate quarter lines by evaluating them as the
    // nearer half line. For full fidelity, use HANDICAP_ASIAN which
    // returns refund amounts.
    const quarter = Math.abs((line * 4) % 2) !== 0;
    const effective = quarter ? Math.round(line * 2) / 2 : line;

    if (total === effective) return { result: "VOID", reason: "push" };
    const isOver = total > effective;
    const won = (side === "OVER") === isOver;
    return { result: won ? "WON" : "LOST" };
  },
});
