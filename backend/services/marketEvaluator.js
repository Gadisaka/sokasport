/**
 * Market Evaluation Engine.
 *
 * Single source of truth for grading a `TicketSelection` row against a
 * resolved match outcome. The engine is intentionally pure: it takes the
 * locked selection (canonical market_code + market_params + label that
 * were stored at placement time) plus a normalized match result and
 * returns one of the four `SelectionResult` enum values.
 *
 * Adding new markets is a localized change: register a new handler in
 * `MARKET_HANDLERS`. Unknown markets fall back to a defensive PENDING so
 * we never silently misgrade.
 *
 * @module services/marketEvaluator
 */

export const SELECTION_RESULT = Object.freeze({
  PENDING: "PENDING",
  WON: "WON",
  LOST: "LOST",
  VOID: "VOID",
});

export const MARKET_CODES = Object.freeze({
  MATCH_WINNER: "MATCH_WINNER",
  DOUBLE_CHANCE: "DOUBLE_CHANCE",
  OVER_UNDER: "OVER_UNDER",
  BTTS: "BTTS",
  HANDICAP: "HANDICAP",
});

const MATCH_WINNER_ALIASES = new Map([
  ["1", "HOME"],
  ["H", "HOME"],
  ["HOME", "HOME"],
  ["X", "DRAW"],
  ["D", "DRAW"],
  ["DRAW", "DRAW"],
  ["2", "AWAY"],
  ["A", "AWAY"],
  ["AWAY", "AWAY"],
]);

const DOUBLE_CHANCE_ALIASES = new Map([
  ["1X", new Set(["HOME", "DRAW"])],
  ["HOME/DRAW", new Set(["HOME", "DRAW"])],
  ["12", new Set(["HOME", "AWAY"])],
  ["HOME/AWAY", new Set(["HOME", "AWAY"])],
  ["X2", new Set(["DRAW", "AWAY"])],
  ["DRAW/AWAY", new Set(["DRAW", "AWAY"])],
]);

function normalizeLabel(value) {
  return String(value || "").trim().toUpperCase();
}

function pickWinner({ homeScore, awayScore }) {
  if (homeScore > awayScore) return "HOME";
  if (homeScore < awayScore) return "AWAY";
  return "DRAW";
}

function bothScoresKnown(matchResult) {
  return (
    Number.isFinite(matchResult?.homeScore) &&
    Number.isFinite(matchResult?.awayScore)
  );
}

function evaluateMatchWinner(selection, matchResult) {
  if (!bothScoresKnown(matchResult)) {
    return { result: SELECTION_RESULT.PENDING, reason: "missing_scores" };
  }
  const winner = pickWinner(matchResult);
  const label = normalizeLabel(selection?.selection);
  const expected = MATCH_WINNER_ALIASES.get(label);
  if (!expected) {
    return { result: SELECTION_RESULT.PENDING, reason: "unknown_label" };
  }
  return {
    result: expected === winner ? SELECTION_RESULT.WON : SELECTION_RESULT.LOST,
  };
}

function evaluateDoubleChance(selection, matchResult) {
  if (!bothScoresKnown(matchResult)) {
    return { result: SELECTION_RESULT.PENDING, reason: "missing_scores" };
  }
  const winner = pickWinner(matchResult);
  const label = normalizeLabel(selection?.selection);
  const accepted = DOUBLE_CHANCE_ALIASES.get(label);
  if (!accepted) {
    return { result: SELECTION_RESULT.PENDING, reason: "unknown_label" };
  }
  return {
    result: accepted.has(winner)
      ? SELECTION_RESULT.WON
      : SELECTION_RESULT.LOST,
  };
}

function readOverUnderSide(selection) {
  const params = selection?.market_params || {};
  if (params.side) return normalizeLabel(params.side);
  const label = normalizeLabel(selection?.selection);
  if (label.startsWith("OVER") || label === "O") return "OVER";
  if (label.startsWith("UNDER") || label === "U") return "UNDER";
  return null;
}

function readOverUnderLine(selection) {
  const params = selection?.market_params || {};
  const candidates = [params.line, params.handicap, params.value];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num)) return num;
  }
  // Try parsing trailing number from the human label, e.g. "Over 2.5".
  const fromLabel = String(selection?.selection || "").match(/-?\d+(?:\.\d+)?/);
  if (fromLabel) {
    const num = Number(fromLabel[0]);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function evaluateOverUnder(selection, matchResult) {
  if (!bothScoresKnown(matchResult)) {
    return { result: SELECTION_RESULT.PENDING, reason: "missing_scores" };
  }
  const total = matchResult.homeScore + matchResult.awayScore;
  const side = readOverUnderSide(selection);
  const line = readOverUnderLine(selection);
  if (!side || !Number.isFinite(line)) {
    return { result: SELECTION_RESULT.PENDING, reason: "missing_line_or_side" };
  }
  // Whole-number lines tie at total === line and refund the stake.
  if (total === line) return { result: SELECTION_RESULT.VOID, reason: "push" };
  const isOverWon = total > line;
  if (side === "OVER") {
    return {
      result: isOverWon ? SELECTION_RESULT.WON : SELECTION_RESULT.LOST,
    };
  }
  return {
    result: isOverWon ? SELECTION_RESULT.LOST : SELECTION_RESULT.WON,
  };
}

function evaluateBtts(selection, matchResult) {
  if (!bothScoresKnown(matchResult)) {
    return { result: SELECTION_RESULT.PENDING, reason: "missing_scores" };
  }
  const both = matchResult.homeScore > 0 && matchResult.awayScore > 0;
  const params = selection?.market_params || {};
  const sideRaw = params.side || params.value || selection?.selection;
  const side = normalizeLabel(sideRaw);
  let expected;
  if (side === "YES" || side === "Y") expected = true;
  else if (side === "NO" || side === "N") expected = false;
  else return { result: SELECTION_RESULT.PENDING, reason: "unknown_side" };
  return {
    result: expected === both ? SELECTION_RESULT.WON : SELECTION_RESULT.LOST,
  };
}

function readHandicapSide(selection) {
  const params = selection?.market_params || {};
  if (params.side) return normalizeLabel(params.side);
  const label = normalizeLabel(selection?.selection);
  if (label.startsWith("HOME") || label === "H" || label === "1") return "HOME";
  if (label.startsWith("AWAY") || label === "A" || label === "2") return "AWAY";
  return null;
}

function readHandicapValue(selection) {
  const params = selection?.market_params || {};
  const candidates = [params.handicap, params.line, params.value];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num)) return num;
  }
  const fromLabel = String(selection?.selection || "").match(/-?\d+(?:\.\d+)?/);
  if (fromLabel) {
    const num = Number(fromLabel[0]);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function evaluateHandicap(selection, matchResult) {
  if (!bothScoresKnown(matchResult)) {
    return { result: SELECTION_RESULT.PENDING, reason: "missing_scores" };
  }
  const side = readHandicapSide(selection);
  const handicap = readHandicapValue(selection);
  if (!side || !Number.isFinite(handicap)) {
    return { result: SELECTION_RESULT.PENDING, reason: "missing_handicap" };
  }
  let adjustedHome = matchResult.homeScore;
  let adjustedAway = matchResult.awayScore;
  if (side === "HOME") adjustedHome += handicap;
  else adjustedAway += handicap;
  if (adjustedHome === adjustedAway) {
    return { result: SELECTION_RESULT.VOID, reason: "push" };
  }
  const homeWins = adjustedHome > adjustedAway;
  if (side === "HOME") {
    return {
      result: homeWins ? SELECTION_RESULT.WON : SELECTION_RESULT.LOST,
    };
  }
  return {
    result: homeWins ? SELECTION_RESULT.LOST : SELECTION_RESULT.WON,
  };
}

const MARKET_HANDLERS = Object.freeze({
  [MARKET_CODES.MATCH_WINNER]: evaluateMatchWinner,
  [MARKET_CODES.DOUBLE_CHANCE]: evaluateDoubleChance,
  [MARKET_CODES.OVER_UNDER]: evaluateOverUnder,
  [MARKET_CODES.BTTS]: evaluateBtts,
  [MARKET_CODES.HANDICAP]: evaluateHandicap,
});

const LEGACY_MARKET_PATTERNS = [
  { pattern: /^match\s*winner$|^1x2$|^match\s*result$/i, code: MARKET_CODES.MATCH_WINNER },
  { pattern: /double\s*chance/i, code: MARKET_CODES.DOUBLE_CHANCE },
  { pattern: /over\/under|goals\s*over\/under|total\s*goals/i, code: MARKET_CODES.OVER_UNDER },
  { pattern: /both\s*teams.*score|btts/i, code: MARKET_CODES.BTTS },
  { pattern: /handicap|asian\s*handicap/i, code: MARKET_CODES.HANDICAP },
];

/**
 * Best-effort canonicalization for legacy snapshot rows that only carry
 * a free-form market label. Returns null when the label cannot be mapped
 * confidently — callers must keep the selection PENDING in that case.
 */
export function inferMarketCode({ market_code, marketLabel, selection } = {}) {
  if (market_code) return String(market_code).toUpperCase();
  const candidates = [marketLabel, selection].map((value) =>
    String(value || "").trim(),
  );
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const { pattern, code } of LEGACY_MARKET_PATTERNS) {
      if (pattern.test(candidate)) return code;
    }
  }
  // Heuristic: a label like "Over 2.5" / "Under 1.5" is unambiguous on its own.
  const label = String(selection || "").toUpperCase();
  if (/^(OVER|UNDER)\s*\d/.test(label)) return MARKET_CODES.OVER_UNDER;
  return null;
}

/**
 * Evaluate a selection against a normalized match result.
 *
 * @param {Object} selection - locked selection row (must include
 *   `selection`, optional `market_code`, optional `market_params`).
 * @param {Object} matchResult - { homeScore, awayScore, finalized,
 *   voided, status, result } — see `services/ticketSettlementService.js`
 *   for the producers.
 */
export function evaluateSelection(selection, matchResult) {
  if (!selection) {
    return { result: SELECTION_RESULT.PENDING, reason: "missing_selection" };
  }
  if (!matchResult) {
    return { result: SELECTION_RESULT.PENDING, reason: "missing_match_result" };
  }
  if (matchResult.voided) {
    return { result: SELECTION_RESULT.VOID, reason: "match_voided" };
  }
  if (!matchResult.finalized) {
    return { result: SELECTION_RESULT.PENDING, reason: "match_not_finalized" };
  }

  const code = inferMarketCode(selection);
  const handler = code ? MARKET_HANDLERS[code] : null;
  if (handler) {
    const graded = handler(selection, matchResult);
    if (graded.result !== SELECTION_RESULT.PENDING) return graded;

    // Admin-managed Match settlement can finalize with a string result
    // but without numeric scores. In that case, use the legacy exact-label
    // compare instead of leaving the selection permanently PENDING.
    if (matchResult.result) {
      const expected = String(matchResult.result).trim();
      const actual = String(selection.selection || "").trim();
      return {
        result:
          expected === actual ? SELECTION_RESULT.WON : SELECTION_RESULT.LOST,
        reason: "legacy_string_match",
      };
    }
    return graded;
  }

  // Legacy fallback: admin-managed Match path stores a free-form
  // `result` string. Compare the selection label verbatim. We never
  // grade as LOST when no result is provided so a partially populated
  // record cannot accidentally settle.
  if (matchResult.result) {
    const expected = String(matchResult.result).trim();
    const actual = String(selection.selection || "").trim();
    return {
      result:
        expected === actual ? SELECTION_RESULT.WON : SELECTION_RESULT.LOST,
      reason: "legacy_string_match",
    };
  }
  return { result: SELECTION_RESULT.PENDING, reason: "unknown_market" };
}
