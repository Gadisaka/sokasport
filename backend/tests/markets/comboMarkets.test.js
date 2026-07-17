/**
 * Combination markets — AND of two FT-score outcomes. Graded by delegating to
 * the base graders; both must WIN; a VOID leg → combo VOID. Compound value
 * labels ("Home/Over 2.5") parsed via the label fallback.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSelection } from "../../services/marketEvaluatorV2.js";
import { buildMatchResultV2FromFixture } from "../../services/matchResult/v2.js";
import { classifySelectionSupport } from "../../services/markets/marketSupport.js";

const fx = (h, a) => ({
  id: "fx", api_fixture_id: 1, status: "FT", home_score: h, away_score: a,
  ht_home_score: null, ht_away_score: null, events_payload: null,
  stats_payload: null, result_version: 0,
});
// name-only payload (the frontend shape): marketLabel + compound value label.
const g = (name, label, h, a) =>
  evaluateSelection({ marketLabel: name, market_code: undefined, selection: label, market_params: {} }, buildMatchResultV2FromFixture(fx(h, a))).result;
// direct code form (for explicit assertions)
const gc = (code, params, label, h, a) =>
  evaluateSelection({ market_code: code, market_params: params, selection: label }, buildMatchResultV2FromFixture(fx(h, a))).result;

test("RESULT_TOTAL: Home/Over 2.5", () => {
  assert.equal(gc("RESULT_TOTAL_FT", {}, "Home/Over 2.5", 3, 1), "WON"); // home win + 4 goals
  assert.equal(gc("RESULT_TOTAL_FT", {}, "Home/Over 2.5", 1, 0), "LOST"); // home win but only 1 goal
  assert.equal(gc("RESULT_TOTAL_FT", {}, "Away/Under 2.5", 0, 1), "WON"); // away win + 1 goal
  assert.equal(gc("RESULT_TOTAL_FT", {}, "Home/Over 2.5", 1, 2), "LOST"); // both legs lose
});

test("TOTAL/BTTS: Over 2.5/Yes", () => {
  assert.equal(gc("TOTAL_GOALS_BTTS", {}, "Over 2.5/Yes", 2, 1), "WON"); // 3 goals + both scored
  assert.equal(gc("TOTAL_GOALS_BTTS", {}, "Over 2.5/Yes", 3, 0), "LOST"); // 3 goals but away didn't score
  assert.equal(gc("TOTAL_GOALS_BTTS", {}, "Under 2.5/No", 1, 0), "WON"); // 1 goal + not both
});

test("TOTAL/BTTS: API-Sports abbreviated labels (line in second part)", () => {
  assert.equal(gc("TOTAL_GOALS_BTTS", {}, "U/YES 2.5", 1, 1), "WON"); // under + both scored
  assert.equal(gc("TOTAL_GOALS_BTTS", {}, "U/YES 2.5", 0, 1), "LOST"); // under but away only scored
  assert.equal(gc("TOTAL_GOALS_BTTS", {}, "O/NO 2.5", 3, 0), "WON"); // over + not both
});

test("RESULT/BTTS: Home/Yes (the combo the report mis-mapped to plain BTTS)", () => {
  assert.equal(gc("RESULT_BTTS_FT", {}, "Home/Yes", 2, 1), "WON"); // home win + both scored
  assert.equal(gc("RESULT_BTTS_FT", {}, "Home/Yes", 1, 0), "LOST"); // home win but away didn't score
  assert.equal(gc("RESULT_BTTS_FT", {}, "Draw/Yes", 1, 1), "WON"); // draw + both scored
});

test("WIN_TO_NIL generic: Home / Away / No", () => {
  assert.equal(gc("WIN_TO_NIL", { side: "HOME" }, "Home", 2, 0), "WON");
  assert.equal(gc("WIN_TO_NIL", { side: "HOME" }, "Home", 2, 1), "LOST"); // conceded
  assert.equal(gc("WIN_TO_NIL", { side: "NONE" }, "No", 2, 1), "WON");     // neither won to nil
  assert.equal(gc("WIN_TO_NIL", { side: "AWAY" }, "Away", 0, 3), "WON");
});

test("combo VOIDs when a leg pushes (whole-line total)", () => {
  // Over 3 on exactly 3 goals → total leg pushes (VOID) → combo VOID.
  assert.equal(gc("RESULT_TOTAL_FT", {}, "Home/Over 3", 2, 1), "VOID");
});

test("name-only round-trip: combos resolve under score phase + grade", () => {
  const prev = process.env.MARKET_ALLOWLIST_PHASE;
  process.env.MARKET_ALLOWLIST_PHASE = "score";
  try {
    for (const [name, label, want] of [
      ["Result/Total Goals", "Home/Over 2.5", "RESULT_TOTAL_FT"],
      ["Total Goals/Both Teams To Score", "Over 2.5/Yes", "TOTAL_GOALS_BTTS"],
      ["Total Goals/Both Teams To Score", "U/YES 2.5", "TOTAL_GOALS_BTTS"],
      ["Results/Both Teams Score", "Home/Yes", "RESULT_BTTS_FT"],
      ["Win to Nil", "Home", "WIN_TO_NIL"],
    ]) {
      const r = classifySelectionSupport({ marketLabel: name, label, selection: label }, { mode: "strict" });
      assert.equal(r.ok, true, `${name}: ${r.reason}`);
      assert.equal(r.code, want, `${name} -> ${r.code}`);
    }
  } finally {
    if (prev === undefined) delete process.env.MARKET_ALLOWLIST_PHASE;
    else process.env.MARKET_ALLOWLIST_PHASE = prev;
  }
});
