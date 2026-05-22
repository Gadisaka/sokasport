import { ValidationError } from "./errors.js";

function normalizeSide(raw) {
  const key = String(raw || "").trim().toUpperCase();
  if (key === "HOME" || key === "H" || key === "1") return "HOME";
  if (key === "AWAY" || key === "A" || key === "2") return "AWAY";
  return null;
}

function normalizeHandicap(raw) {
  // Asian handicaps are on a 0.25 step. Examples: -1.25, -1.0, -0.75,
  // -0.5, -0.25, 0, +0.25, +0.5 …
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const scaled = Math.round(n * 4);
  if (Math.abs(n * 4 - scaled) > 1e-9) return null;
  return scaled / 4;
}

function settleHalf(side, handicap, home, away) {
  let hh = home;
  let aa = away;
  if (side === "HOME") hh += handicap;
  else aa += handicap;
  if (hh === aa) return "VOID";
  const sideWins = side === "HOME" ? hh > aa : aa > hh;
  return sideWins ? "WON" : "LOST";
}

/**
 * Quarter lines split stake 50/50 across two adjacent half lines. Our
 * engine only returns a single WON/LOST/VOID per leg, so we approximate
 * financial quarter-line behavior as follows:
 *   - both halves WON   → WON  (full payout)
 *   - both halves LOST  → LOST (full loss)
 *   - one WON + one VOID → WON (stake * (odds+1)/2 is approximated by
 *       our single-leg WON; books normally pay "half win" — the
 *       settlement service receives `reason: "quarter_half_win"` so
 *       downstream reporting can tell the difference)
 *   - one LOST + one VOID → LOST
 *   - impossible combination (e.g. WON+LOST) → VOID
 */
export default Object.freeze({
  code: "HANDICAP_ASIAN",
  version: 1,
  aliases: ["ASIAN_HANDICAP", "AH"],
  description: "Asian handicap — full, half, and quarter lines",
  requiredResultFields: ["scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "VOID",
  },

  validate(params) {
    const side = normalizeSide(params?.side);
    if (!side) throw new ValidationError("invalid_side", { field: "side" });
    const handicap = normalizeHandicap(params?.handicap ?? params?.line ?? params?.value);
    if (handicap === null) throw new ValidationError("invalid_handicap", { field: "handicap" });
    return { side, handicap };
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
    if (!side || handicap === null) {
      return { result: "VOID", reason: "invalid_selection_params" };
    }
    const { home, away } = mr.scores.fullTime;

    const isQuarter = Math.abs((handicap * 4) % 2) !== 0;
    if (!isQuarter) {
      // Full or half line: single settlement.
      const r = settleHalf(side, handicap, home, away);
      if (r === "VOID") return { result: "VOID", reason: "push" };
      return { result: r };
    }

    // Quarter line: split into two halves (handicap ± 0.25).
    const lower = Math.floor(handicap * 2) / 2;
    const upper = Math.ceil(handicap * 2) / 2;
    const r1 = settleHalf(side, lower, home, away);
    const r2 = settleHalf(side, upper, home, away);
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
