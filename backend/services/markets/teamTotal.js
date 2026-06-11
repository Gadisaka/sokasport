import { ValidationError } from "./errors.js";
import { resolveParamsViaValidate } from "./_resolveParams.js";

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

// Label like "Over 1.5" / "Under 2" → { side, line }. The TEAM is NOT in the
// label (the TEAM_TOTAL_HOME/AWAY catalog wrappers inject it into params), so
// only side+line are parsed here.
function parseLabel(label) {
  const s = String(label || "").trim();
  const m = /(over|under|o|u)\b/i.exec(s);
  if (!m) return { side: null, line: null };
  const numMatch = s.match(/-?\d+(?:\.\d+)?/);
  return {
    side: normalizeSide(m[1]),
    line: numMatch ? normalizeLine(numMatch[0]) : null,
  };
}

function validate(params, ctx) {
  const fromLabel = parseLabel(ctx?.label);
  const team = normalizeTeam(params?.team);
  if (!team) throw new ValidationError("invalid_team", { field: "team" });
  const side = normalizeSide(params?.side) ?? fromLabel.side;
  if (!side) throw new ValidationError("invalid_side", { field: "side" });
  const explicitLine = normalizeLine(params?.line ?? params?.value);
  const line = explicitLine ?? fromLabel.line;
  if (line === null) throw new ValidationError("invalid_line", { field: "line" });
  return { team, side, line };
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

  validate,

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const params = resolveParamsViaValidate(selection, validate);
    const team = params?.team;
    const side = params?.side;
    const line = params == null ? null : params.line;
    if (!team || !side || line === null || line === undefined) {
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
