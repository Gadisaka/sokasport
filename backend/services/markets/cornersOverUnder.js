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
  const scaled = Math.round(n * 4);
  if (Math.abs(n * 4 - scaled) > 1e-9) return null;
  const line = scaled / 4;
  return line >= 0 ? line : null;
}

export default Object.freeze({
  code: "CORNERS_OVER_UNDER",
  version: 1,
  aliases: ["TOTAL_CORNERS"],
  description: "Full-time total corners (over / under)",
  requiredResultFields: ["stats.corners.home", "stats.corners.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "VOID",
  },

  validate(params) {
    const side = normalizeSide(params?.side);
    if (!side) throw new ValidationError("invalid_side", { field: "side" });
    const line = normalizeLine(params?.line ?? params?.value);
    if (line === null) throw new ValidationError("invalid_line", { field: "line" });
    return { side, line };
  },

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.stats?.corners?.home) &&
      Number.isInteger(mr?.stats?.corners?.away)
    );
  },

  evaluate(selection, mr) {
    const side = normalizeSide(selection?.market_params?.side);
    const line = normalizeLine(selection?.market_params?.line);
    if (!side || line === null) {
      return { result: "VOID", reason: "invalid_selection_params" };
    }
    const total = mr.stats.corners.home + mr.stats.corners.away;
    if (total === line) return { result: "VOID", reason: "push" };
    const isOver = total > line;
    return { result: (side === "OVER") === isOver ? "WON" : "LOST" };
  },
});
