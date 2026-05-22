/**
 * Unit tests for `services/marketEvaluator.js`.
 *
 * Run with:  node --test backend/tests/marketEvaluator.test.js
 *
 * The evaluator is pure so we don't need a database. Each test exercises
 * one market handler plus its edge cases (missing scores, push, void on
 * cancelled match).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSelection,
  inferMarketCode,
  MARKET_CODES,
  SELECTION_RESULT,
} from "../services/marketEvaluator.js";

const finalScores = (homeScore, awayScore) => ({
  homeScore,
  awayScore,
  finalized: true,
  voided: false,
});

test("evaluateSelection: PENDING when match not finalized", () => {
  const sel = { selection: "Home", market_code: MARKET_CODES.MATCH_WINNER };
  const result = evaluateSelection(sel, {
    homeScore: 1,
    awayScore: 0,
    finalized: false,
    voided: false,
  });
  assert.equal(result.result, SELECTION_RESULT.PENDING);
});

test("evaluateSelection: VOID on cancelled/abandoned match", () => {
  const sel = { selection: "Home", market_code: MARKET_CODES.MATCH_WINNER };
  const result = evaluateSelection(sel, {
    homeScore: null,
    awayScore: null,
    finalized: false,
    voided: true,
  });
  assert.equal(result.result, SELECTION_RESULT.VOID);
});

test("MATCH_WINNER: home win grades label '1' as WON", () => {
  const sel = { selection: "1", market_code: MARKET_CODES.MATCH_WINNER };
  const r = evaluateSelection(sel, finalScores(2, 1));
  assert.equal(r.result, SELECTION_RESULT.WON);
});

test("MATCH_WINNER: home win grades 'AWAY' label as LOST", () => {
  const sel = {
    selection: "AWAY",
    market_code: MARKET_CODES.MATCH_WINNER,
  };
  const r = evaluateSelection(sel, finalScores(2, 1));
  assert.equal(r.result, SELECTION_RESULT.LOST);
});

test("MATCH_WINNER: draw grades 'X' as WON", () => {
  const sel = { selection: "X", market_code: MARKET_CODES.MATCH_WINNER };
  const r = evaluateSelection(sel, finalScores(1, 1));
  assert.equal(r.result, SELECTION_RESULT.WON);
});

test("DOUBLE_CHANCE: 1X wins on home win", () => {
  const sel = { selection: "1X", market_code: MARKET_CODES.DOUBLE_CHANCE };
  const r = evaluateSelection(sel, finalScores(3, 0));
  assert.equal(r.result, SELECTION_RESULT.WON);
});

test("DOUBLE_CHANCE: 12 loses on a draw", () => {
  const sel = { selection: "12", market_code: MARKET_CODES.DOUBLE_CHANCE };
  const r = evaluateSelection(sel, finalScores(2, 2));
  assert.equal(r.result, SELECTION_RESULT.LOST);
});

test("OVER_UNDER: Over 2.5 wins when total goals > 2.5", () => {
  const sel = {
    selection: "Over 2.5",
    market_code: MARKET_CODES.OVER_UNDER,
    market_params: { side: "OVER", line: 2.5 },
  };
  const r = evaluateSelection(sel, finalScores(2, 2));
  assert.equal(r.result, SELECTION_RESULT.WON);
});

test("OVER_UNDER: Under 2.5 loses when total goals > 2.5", () => {
  const sel = {
    selection: "Under 2.5",
    market_code: MARKET_CODES.OVER_UNDER,
    market_params: { side: "UNDER", line: 2.5 },
  };
  const r = evaluateSelection(sel, finalScores(2, 2));
  assert.equal(r.result, SELECTION_RESULT.LOST);
});

test("OVER_UNDER: whole-number push = VOID", () => {
  const sel = {
    selection: "Over 3",
    market_code: MARKET_CODES.OVER_UNDER,
    market_params: { side: "OVER", line: 3 },
  };
  const r = evaluateSelection(sel, finalScores(2, 1));
  assert.equal(r.result, SELECTION_RESULT.VOID);
});

test("OVER_UNDER: line parsed from selection label when params missing", () => {
  const sel = {
    selection: "Over 1.5",
    market_code: MARKET_CODES.OVER_UNDER,
  };
  const r = evaluateSelection(sel, finalScores(1, 1));
  assert.equal(r.result, SELECTION_RESULT.WON);
});

test("BTTS: yes wins when both teams scored", () => {
  const sel = {
    selection: "Yes",
    market_code: MARKET_CODES.BTTS,
  };
  const r = evaluateSelection(sel, finalScores(1, 2));
  assert.equal(r.result, SELECTION_RESULT.WON);
});

test("BTTS: no wins when one team failed to score", () => {
  const sel = { selection: "No", market_code: MARKET_CODES.BTTS };
  const r = evaluateSelection(sel, finalScores(2, 0));
  assert.equal(r.result, SELECTION_RESULT.WON);
});

test("HANDICAP: home -1 wins when home wins by 2+", () => {
  const sel = {
    selection: "Home",
    market_code: MARKET_CODES.HANDICAP,
    market_params: { side: "HOME", handicap: -1 },
  };
  const r = evaluateSelection(sel, finalScores(3, 1));
  assert.equal(r.result, SELECTION_RESULT.WON);
});

test("HANDICAP: integer handicap push = VOID", () => {
  const sel = {
    selection: "Away",
    market_code: MARKET_CODES.HANDICAP,
    market_params: { side: "AWAY", handicap: 1 },
  };
  const r = evaluateSelection(sel, finalScores(2, 1));
  assert.equal(r.result, SELECTION_RESULT.VOID);
});

test("inferMarketCode: maps legacy '1X2' label to MATCH_WINNER", () => {
  assert.equal(
    inferMarketCode({ marketLabel: "1X2", selection: "1" }),
    MARKET_CODES.MATCH_WINNER,
  );
});

test("inferMarketCode: maps 'Goals Over/Under' to OVER_UNDER", () => {
  assert.equal(
    inferMarketCode({ marketLabel: "Goals Over/Under", selection: "Over 2.5" }),
    MARKET_CODES.OVER_UNDER,
  );
});

test("inferMarketCode: returns null for unknown labels", () => {
  assert.equal(
    inferMarketCode({ marketLabel: "Custom Special", selection: "Foo" }),
    null,
  );
});

test("legacy fallback grades string-equality result when no market_code", () => {
  const sel = { selection: "Home" };
  const r = evaluateSelection(sel, {
    homeScore: null,
    awayScore: null,
    finalized: true,
    voided: false,
    result: "Home",
  });
  assert.equal(r.result, SELECTION_RESULT.WON);
});

test("legacy fallback grades non-matching result as LOST", () => {
  const sel = { selection: "Home" };
  const r = evaluateSelection(sel, {
    homeScore: null,
    awayScore: null,
    finalized: true,
    voided: false,
    result: "Away",
  });
  assert.equal(r.result, SELECTION_RESULT.LOST);
});

test("missing scores => PENDING (cannot misgrade)", () => {
  const sel = { selection: "1", market_code: MARKET_CODES.MATCH_WINNER };
  const r = evaluateSelection(sel, {
    homeScore: null,
    awayScore: null,
    finalized: true,
    voided: false,
  });
  assert.equal(r.result, SELECTION_RESULT.PENDING);
});
