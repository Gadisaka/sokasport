import { ValidationError } from "./errors.js";
import { resolveParamsViaValidate } from "./_resolveParams.js";

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

// Parse a label like "Over 2.5" / "Under 3" / "O 1.75" → { side, line }.
function parseLabel(label) {
  const s = String(label || "").trim();
  const m = /^(over|under|o|u)\b\s*(-?\d+(?:\.\d+)?)?/i.exec(s);
  if (!m) return { side: null, line: null };
  const numMatch = s.match(/-?\d+(?:\.\d+)?/);
  return {
    side: normalizeSide(m[1]),
    line: numMatch ? normalizeLine(numMatch[0]) : null,
  };
}

function validate(params, ctx) {
  const fromLabel = parseLabel(ctx?.label);
  const side = normalizeSide(params?.side) ?? fromLabel.side;
  if (!side) throw new ValidationError("invalid_side", { field: "side" });
  const explicitLine = normalizeLine(
    params?.line ?? params?.handicap ?? params?.value,
  );
  const line = explicitLine ?? fromLabel.line;
  if (line === null || line < 0) {
    throw new ValidationError("invalid_line", { field: "line" });
  }
  return { side, line };
}

export default Object.freeze({
  code: "OVER_UNDER",
  version: 2,
  aliases: ["GOALS_OVER_UNDER", "TOTALS", "MATCH_TOTAL"],
  description: "Full-time match total goals",
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
    const side = params?.side;
    const line = params == null ? null : params.line;
    if (!side || line === null || line === undefined) {
      return { result: "VOID", reason: "invalid_selection_params" };
    }
    const total = mr.scores.fullTime.home + mr.scores.fullTime.away;

    // Helper: evaluate a single half-line (x.0 or x.5).
    const settleHalf = (halfLine) => {
      if (total === halfLine) return "VOID";
      const isOver = total > halfLine;
      return (side === "OVER") === isOver ? "WON" : "LOST";
    };

    // Quarter lines (x.25 or x.75) split stake 50/50 across two adjacent
    // half-lines. E.g. UNDER 2.75 = half on U2.5 + half on U3.0.
    const isQuarter = Math.abs((line * 4) % 2) !== 0;
    if (!isQuarter) {
      // Full or half line: single settlement.
      const r = settleHalf(line);
      if (r === "VOID") return { result: "VOID", reason: "push" };
      return { result: r };
    }

    // Quarter line: evaluate both adjacent half-lines and combine.
    const lower = Math.floor(line * 2) / 2;
    const upper = Math.ceil(line * 2) / 2;
    const r1 = settleHalf(lower);
    const r2 = settleHalf(upper);
    if (r1 === "WON" && r2 === "WON") return { result: "WON", reason: "quarter_full_win" };
    if (r1 === "LOST" && r2 === "LOST") return { result: "LOST", reason: "quarter_full_loss" };
    if ((r1 === "WON" && r2 === "VOID") || (r1 === "VOID" && r2 === "WON")) {
      return { result: "WON", reason: "quarter_half_win" };
    }
    if ((r1 === "LOST" && r2 === "VOID") || (r1 === "VOID" && r2 === "LOST")) {
      return { result: "LOST", reason: "quarter_half_loss" };
    }
    return { result: "VOID", reason: "quarter_conflicting_halves" };
  },
});
