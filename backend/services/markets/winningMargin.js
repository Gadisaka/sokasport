import { ValidationError } from "./errors.js";

const SIDE_ALIASES = new Map([
  ["1", "HOME"], ["HOME", "HOME"],
  ["2", "AWAY"], ["AWAY", "AWAY"],
  ["X", "DRAW"], ["DRAW", "DRAW"],
]);

function normalizeSide(raw) {
  const key = String(raw || "").trim().toUpperCase();
  return SIDE_ALIASES.get(key) || null;
}

function normalizeMargin(raw) {
  // `margin` can be a fixed integer (exact margin) OR a range like
  // "1-2" / { min: 1, max: 2 } for "by 1 or 2 goals" markets.
  if (raw == null) return null;
  if (typeof raw === "object") {
    const min = Number(raw.min);
    const max = Number(raw.max);
    if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
    if (min < 1 || max < min) return null;
    return { min, max };
  }
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 1) return null;
    return { min: raw, max: raw };
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const min = Number(m[1]);
  const max = m[2] ? Number(m[2]) : min;
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
  if (min < 1 || max < min) return null;
  return { min, max };
}

export default Object.freeze({
  code: "WINNING_MARGIN",
  version: 1,
  aliases: ["MARGIN_OF_VICTORY"],
  description: "Winning side AND margin of victory (or DRAW)",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "NONE",
  },

  validate(params) {
    const side = normalizeSide(params?.side);
    if (!side) throw new ValidationError("invalid_side", { field: "side" });
    if (side === "DRAW") {
      // Draw bucket doesn't need a margin.
      return { side };
    }
    const margin = normalizeMargin(params?.margin);
    if (!margin) throw new ValidationError("invalid_margin", { field: "margin" });
    return { side, margin };
  },

  canEvaluate(mr) {
    return (
      Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away)
    );
  },

  evaluate(selection, mr) {
    const side = normalizeSide(selection?.market_params?.side);
    if (!side) return { result: "VOID", reason: "invalid_selection_side" };
    const { home, away } = mr.scores.fullTime;
    const actualMargin = Math.abs(home - away);

    if (side === "DRAW") {
      return { result: home === away ? "WON" : "LOST" };
    }
    if (home === away) return { result: "LOST" };
    const winner = home > away ? "HOME" : "AWAY";
    if (winner !== side) return { result: "LOST" };

    const margin = selection?.market_params?.margin;
    const range = normalizeMargin(margin);
    if (!range) return { result: "VOID", reason: "invalid_selection_margin" };
    const won = actualMargin >= range.min && actualMargin <= range.max;
    return { result: won ? "WON" : "LOST" };
  },
});
