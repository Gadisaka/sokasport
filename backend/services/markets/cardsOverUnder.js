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
  const scaled = Math.round(n * 4);
  if (Math.abs(n * 4 - scaled) > 1e-9) return null;
  const line = scaled / 4;
  return line >= 0 ? line : null;
}

function parseLabel(label) {
  const s = String(label || "").trim();
  const m = /^(over|under|o|u)\b/i.exec(s);
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
  const explicitLine = normalizeLine(params?.line ?? params?.value);
  const line = explicitLine ?? fromLabel.line;
  if (line === null) throw new ValidationError("invalid_line", { field: "line" });
  const scale = String(params?.scale || "CARDS").toUpperCase();
  if (!["CARDS", "POINTS"].includes(scale)) {
    throw new ValidationError("invalid_scale", { field: "scale" });
  }
  return { side, line, scale };
}

// Standard bookmaker convention: yellow=1 card, red=2 cards. A second
// yellow is typically counted as yellow + red = 3 points, but many books
// only count it as 2 points. We follow the most common rule: second
// yellow counts as a single red for the booking-points total.
function cardPoints(stats, events) {
  if (stats && stats.cards) {
    const hY = stats.cards.home?.yellow ?? 0;
    const hR = stats.cards.home?.red ?? 0;
    const aY = stats.cards.away?.yellow ?? 0;
    const aR = stats.cards.away?.red ?? 0;
    return hY + aY + 2 * (hR + aR);
  }
  // Fallback: derive from events.
  let total = 0;
  for (const e of events || []) {
    if (e.type !== "CARD") continue;
    if (e.color === "YELLOW") total += 1;
    else if (e.color === "RED" || e.color === "SECOND_YELLOW") total += 2;
  }
  return total;
}

export default Object.freeze({
  code: "CARDS_OVER_UNDER",
  version: 1,
  aliases: ["TOTAL_CARDS", "BOOKING_POINTS"],
  description: "Full-time total cards / booking points (over / under)",
  requiredResultFields: ["stats.cards"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "VOID",
  },

  validate,

  canEvaluate(mr) {
    return Boolean(mr?.stats?.cards) || Array.isArray(mr?.events);
  },

  evaluate(selection, mr) {
    const params = resolveParamsViaValidate(selection, validate);
    const side = params?.side;
    const line = params == null ? null : params.line;
    const scale = String(params?.scale || "CARDS").toUpperCase();
    if (!side || line === null || line === undefined) {
      return { result: "VOID", reason: "invalid_selection_params" };
    }

    let total;
    if (scale === "POINTS") {
      total = cardPoints(mr.stats, mr.events);
    } else {
      // Pure cards count.
      const hY = mr.stats?.cards?.home?.yellow ?? 0;
      const hR = mr.stats?.cards?.home?.red ?? 0;
      const aY = mr.stats?.cards?.away?.yellow ?? 0;
      const aR = mr.stats?.cards?.away?.red ?? 0;
      total = hY + hR + aY + aR;
    }

    if (total === line) return { result: "VOID", reason: "push" };
    const isOver = total > line;
    return { result: (side === "OVER") === isOver ? "WON" : "LOST" };
  },
});
