import { ValidationError } from "./errors.js";

function normalizeTeam(raw) {
  const key = String(raw || "").trim().toUpperCase();
  if (key === "HOME" || key === "1") return "HOME";
  if (key === "AWAY" || key === "2") return "AWAY";
  return null;
}

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
  code: "TEAM_TOTAL",
  version: 1,
  aliases: ["TEAM_TOTAL_GOALS", "TEAM_OVER_UNDER"],
  description: "Full-time goals scored by a single team (over / under)",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "VOID",
  },

  validate(params) {
    const team = normalizeTeam(params?.team);
    if (!team) throw new ValidationError("invalid_team", { field: "team" });
    const side = normalizeSide(params?.side);
    if (!side) throw new ValidationError("invalid_side", { field: "side" });
    const line = normalizeLine(params?.line ?? params?.value);
    if (line === null) throw new ValidationError("invalid_line", { field: "line" });
    return { team, side, line };
  },

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const team = normalizeTeam(selection?.market_params?.team);
    const side = normalizeSide(selection?.market_params?.side);
    const line = normalizeLine(selection?.market_params?.line);
    if (!team || !side || line === null) {
      return { result: "VOID", reason: "invalid_selection_params" };
    }
    const total = team === "HOME"
      ? mr.scores.fullTime.home
      : mr.scores.fullTime.away;
    if (total === line) return { result: "VOID", reason: "push" };
    const isOver = total > line;
    return { result: (side === "OVER") === isOver ? "WON" : "LOST" };
  },
});
