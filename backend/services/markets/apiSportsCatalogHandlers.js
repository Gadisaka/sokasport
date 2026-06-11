/**
 * Handlers for API-Sports catalogue markets (see apiSportsBetIdMap.generated.js).
 * Codes without an explicit entry use FT-score defaults or VOID pending rules.
 *
 * @module services/markets/apiSportsCatalogHandlers
 */
import { ValidationError } from "./errors.js";
import { resolveParamsViaValidate } from "./_resolveParams.js";
import matchWinner from "./matchWinner.js";
import doubleChance from "./doubleChance.js";
import drawNoBet from "./drawNoBet.js";
import overUnder from "./overUnder.js";
import oddEven from "./oddEven.js";
import correctScore from "./correctScore.js";
import handicapAsian from "./handicapAsian.js";
import handicapEuropean from "./handicapEuropean.js";
import goalscorerAnytime from "./goalscorerAnytime.js";
import firstGoalscorer from "./firstGoalscorer.js";
import lastGoalscorer from "./lastGoalscorer.js";
import btts from "./btts.js";
import teamTotal from "./teamTotal.js";
import playerShots from "./playerShots.js";

export const defaultSettlePolicy = Object.freeze({
  voidOnVoidFixture: true,
  voidOnAwardedWithoutScores: true,
  pushPolicy: "VOID",
});

/** @param {object} mr */
export function secondHalfScores(mr) {
  const ft = mr?.scores?.fullTime;
  const ht = mr?.scores?.halfTime;
  if (
    !Number.isInteger(ft?.home) ||
    !Number.isInteger(ft?.away) ||
    !Number.isInteger(ht?.home) ||
    !Number.isInteger(ht?.away)
  ) {
    return null;
  }
  return { home: ft.home - ht.home, away: ft.away - ht.away };
}

function firstHalfScores(mr) {
  const ht = mr?.scores?.halfTime;
  if (!Number.isInteger(ht?.home) || !Number.isInteger(ht?.away)) return null;
  return { home: ht.home, away: ht.away };
}

function voidStub(reason) {
  return { result: "VOID", reason };
}

function synthFt(mr, pair) {
  return { ...mr, scores: { ...mr.scores, fullTime: pair } };
}

const HANDLERS = Object.create(null);

function reg(code, h) {
  HANDLERS[code] = h;
}

reg("SECOND_HALF_RESULT", {
  validate: matchWinner.validate.bind(matchWinner),
  canEvaluate: (mr) => secondHalfScores(mr) != null,
  evaluate(sel, mr) {
    return matchWinner.evaluate(sel, synthFt(mr, secondHalfScores(mr)));
  },
});

reg("SH_OVER_UNDER", {
  validate: overUnder.validate.bind(overUnder),
  canEvaluate: (mr) => secondHalfScores(mr) != null,
  evaluate(sel, mr) {
    return overUnder.evaluate(sel, synthFt(mr, secondHalfScores(mr)));
  },
});

["HANDICAP_ASIAN_HT", "HANDICAP_ASIAN_SH"].forEach((code, idx) => {
  reg(code, {
    validate: handicapAsian.validate.bind(handicapAsian),
    canEvaluate: (mr) =>
      idx === 0 ? firstHalfScores(mr) != null : secondHalfScores(mr) != null,
    evaluate(sel, mr) {
      const pair = idx === 0 ? firstHalfScores(mr) : secondHalfScores(mr);
      return handicapAsian.evaluate(sel, synthFt(mr, pair));
    },
  });
});

["HANDICAP_EUROPEAN_HT", "HANDICAP_EUROPEAN_SH"].forEach((code, idx) => {
  reg(code, {
    validate: handicapEuropean.validate.bind(handicapEuropean),
    canEvaluate: (mr) =>
      idx === 0 ? firstHalfScores(mr) != null : secondHalfScores(mr) != null,
    evaluate(sel, mr) {
      const pair = idx === 0 ? firstHalfScores(mr) : secondHalfScores(mr);
      return handicapEuropean.evaluate(sel, synthFt(mr, pair));
    },
  });
});

["DOUBLE_CHANCE_HT", "DOUBLE_CHANCE_SH"].forEach((code, idx) => {
  reg(code, {
    validate: doubleChance.validate.bind(doubleChance),
    canEvaluate: (mr) =>
      idx === 0 ? firstHalfScores(mr) != null : secondHalfScores(mr) != null,
    evaluate(sel, mr) {
      const pair = idx === 0 ? firstHalfScores(mr) : secondHalfScores(mr);
      return doubleChance.evaluate(sel, synthFt(mr, pair));
    },
  });
});

["ODD_EVEN_HT", "ODD_EVEN_SH"].forEach((code, idx) => {
  reg(code, {
    validate: oddEven.validate.bind(oddEven),
    canEvaluate: (mr) =>
      idx === 0 ? firstHalfScores(mr) != null : secondHalfScores(mr) != null,
    evaluate(sel, mr) {
      const pair = idx === 0 ? firstHalfScores(mr) : secondHalfScores(mr);
      return oddEven.evaluate(sel, synthFt(mr, pair));
    },
  });
});

reg("ODD_EVEN_HOME_TEAM", {
  validate: oddEven.validate.bind(oddEven),
  canEvaluate: (mr) =>
    Number.isInteger(mr?.scores?.fullTime?.home) &&
    Number.isInteger(mr?.scores?.fullTime?.away),
  evaluate(sel, mr) {
    const total = mr.scores.fullTime.home;
    const pick = String(sel.market_params?.pick || "").toUpperCase();
    const isEven = total % 2 === 0;
    const won = (pick === "EVEN") === isEven;
    return { result: won ? "WON" : "LOST" };
  },
});

reg("ODD_EVEN_AWAY_TEAM", {
  validate: oddEven.validate.bind(oddEven),
  canEvaluate: (mr) =>
    Number.isInteger(mr?.scores?.fullTime?.home) &&
    Number.isInteger(mr?.scores?.fullTime?.away),
  evaluate(sel, mr) {
    const total = mr.scores.fullTime.away;
    const pick = String(sel.market_params?.pick || "").toUpperCase();
    const isEven = total % 2 === 0;
    const won = (pick === "EVEN") === isEven;
    return { result: won ? "WON" : "LOST" };
  },
});

["CORRECT_SCORE_HT", "CORRECT_SCORE_SH"].forEach((code, idx) => {
  reg(code, {
    validate: correctScore.validate.bind(correctScore),
    canEvaluate: (mr) =>
      idx === 0 ? firstHalfScores(mr) != null : secondHalfScores(mr) != null,
    evaluate(sel, mr) {
      const pair = idx === 0 ? firstHalfScores(mr) : secondHalfScores(mr);
      return correctScore.evaluate(sel, synthFt(mr, pair));
    },
  });
});

["BTTS_HT", "BTTS_SH"].forEach((code, idx) => {
  reg(code, {
    validate: btts.validate.bind(btts),
    canEvaluate: (mr) =>
      idx === 0 ? firstHalfScores(mr) != null : secondHalfScores(mr) != null,
    evaluate(sel, mr) {
      const pair = idx === 0 ? firstHalfScores(mr) : secondHalfScores(mr);
      return btts.evaluate(sel, synthFt(mr, pair));
    },
  });
});

["DRAW_NO_BET_HT", "DRAW_NO_BET_SH"].forEach((code, idx) => {
  reg(code, {
    validate: drawNoBet.validate.bind(drawNoBet),
    canEvaluate: (mr) =>
      idx === 0 ? firstHalfScores(mr) != null : secondHalfScores(mr) != null,
    evaluate(sel, mr) {
      const pair = idx === 0 ? firstHalfScores(mr) : secondHalfScores(mr);
      return drawNoBet.evaluate(sel, synthFt(mr, pair));
    },
  });
});

reg("TEAM_TOTAL_HOME", {
  validate: (p, ctx) => teamTotal.validate({ ...p, team: "HOME" }, ctx),
  canEvaluate: teamTotal.canEvaluate.bind(teamTotal),
  evaluate(sel, mr) {
    return teamTotal.evaluate(
      { ...sel, market_params: { ...sel.market_params, team: "HOME" } },
      mr,
    );
  },
});

reg("TEAM_TOTAL_AWAY", {
  validate: (p, ctx) => teamTotal.validate({ ...p, team: "AWAY" }, ctx),
  canEvaluate: teamTotal.canEvaluate.bind(teamTotal),
  evaluate(sel, mr) {
    return teamTotal.evaluate(
      { ...sel, market_params: { ...sel.market_params, team: "AWAY" } },
      mr,
    );
  },
});

function sideGoalscorer(team) {
  return {
    validate: goalscorerAnytime.validate.bind(goalscorerAnytime),
    canEvaluate: goalscorerAnytime.canEvaluate.bind(goalscorerAnytime),
    evaluate(sel, mr) {
      const pid = String(sel.market_params?.playerId || "");
      const goals = (mr.events || []).filter(
        (e) =>
          e.type === "GOAL" &&
          !e.flags?.ownGoal &&
          !e.flags?.varOverturned &&
          e.scorer?.id === pid &&
          e.team === team,
      );
      return { result: goals.length ? "WON" : "LOST" };
    },
  };
}

reg("GOALSCORER_ANYTIME_HOME", sideGoalscorer("HOME"));
reg("GOALSCORER_ANYTIME_AWAY", sideGoalscorer("AWAY"));

function firstGsTeam(team) {
  return {
    validate: firstGoalscorer.validate.bind(firstGoalscorer),
    canEvaluate: firstGoalscorer.canEvaluate.bind(firstGoalscorer),
    evaluate(sel, mr) {
      const base = firstGoalscorer.evaluate(sel, mr);
      if (base.result !== "WON") return base;
      const goals = (mr.events || []).filter(
        (e) => e.type === "GOAL" && !e.flags?.ownGoal && !e.flags?.varOverturned,
      );
      const first = goals[0];
      return first?.team === team ? base : { result: "LOST" };
    },
  };
}

reg("FIRST_GOALSCORER_HOME", firstGsTeam("HOME"));
reg("FIRST_GOALSCORER_AWAY", firstGsTeam("AWAY"));

function lastGsTeam(team) {
  return {
    validate: lastGoalscorer.validate.bind(lastGoalscorer),
    canEvaluate: lastGoalscorer.canEvaluate.bind(lastGoalscorer),
    evaluate(sel, mr) {
      const base = lastGoalscorer.evaluate(sel, mr);
      if (base.result !== "WON") return base;
      const goals = (mr.events || []).filter(
        (e) => e.type === "GOAL" && !e.flags?.ownGoal && !e.flags?.varOverturned,
      );
      const last = goals[goals.length - 1];
      return last?.team === team ? base : { result: "LOST" };
    },
  };
}

reg("LAST_GOALSCORER_HOME", lastGsTeam("HOME"));
reg("LAST_GOALSCORER_AWAY", lastGsTeam("AWAY"));

reg("PLAYER_SHOTS_HOME_WRAPPER", {
  validate: (p, ctx) => playerShots.validate({ ...p, scope: "TOTAL" }, ctx),
  canEvaluate: playerShots.canEvaluate.bind(playerShots),
  evaluate: playerShots.evaluate.bind(playerShots),
});

reg("PLAYER_SHOTS_AWAY_WRAPPER", {
  validate: (p, ctx) => playerShots.validate({ ...p, scope: "TOTAL" }, ctx),
  canEvaluate: playerShots.canEvaluate.bind(playerShots),
  evaluate: playerShots.evaluate.bind(playerShots),
});

// ===========================================================================
// SCORE-DERIVED markets (Stream 1). Pure functions over scores.fullTime /
// scores.halfTime — present on ~100% of fixtures, so these grade universally
// (unlike the league-gated stat markets). Each uses the label-fallback pattern
// via resolveParamsViaValidate so a leg with empty params still grades.
// ===========================================================================

function ftPair(mr) {
  const ft = mr?.scores?.fullTime;
  return Number.isInteger(ft?.home) && Number.isInteger(ft?.away) ? ft : null;
}
const ftCanEval = (mr) => ftPair(mr) != null;
const halvesCanEval = (mr) =>
  firstHalfScores(mr) != null && secondHalfScores(mr) != null;

// --- Yes/No markets ---
const YN_ALIASES = new Map([
  ["YES", "YES"], ["Y", "YES"], ["1", "YES"], ["OVER", "YES"],
  ["NO", "NO"], ["N", "NO"], ["2", "NO"], ["UNDER", "NO"],
]);
function ynValidate(params, ctx) {
  const raw = params?.pick ?? params?.side ?? ctx?.label;
  const pick = YN_ALIASES.get(String(raw || "").trim().toUpperCase());
  if (!pick) throw new ValidationError("invalid_pick", { field: "pick" });
  return { pick };
}
/** @param {(mr:object)=>boolean} predicate did the YES condition occur */
function ynHandler(predicate, canEval = ftCanEval) {
  return {
    validate: ynValidate,
    canEvaluate: canEval,
    evaluate(sel, mr) {
      const p = resolveParamsViaValidate(sel, ynValidate);
      if (!p?.pick) return { result: "VOID", reason: "invalid_selection_pick" };
      const happened = predicate(mr);
      return { result: (p.pick === "YES") === happened ? "WON" : "LOST" };
    },
  };
}

reg("CLEAN_SHEET_HOME", ynHandler((mr) => ftPair(mr).away === 0));
reg("CLEAN_SHEET_AWAY", ynHandler((mr) => ftPair(mr).home === 0));
reg("CLEAN_SHEET_EITHER", ynHandler((mr) => { const ft = ftPair(mr); return ft.home === 0 || ft.away === 0; }));
reg("WIN_TO_NIL_HOME", ynHandler((mr) => { const ft = ftPair(mr); return ft.home > ft.away && ft.away === 0; }));
reg("WIN_TO_NIL_AWAY", ynHandler((mr) => { const ft = ftPair(mr); return ft.away > ft.home && ft.home === 0; }));
reg("TEAM_TO_SCORE_YESNO_HOME", ynHandler((mr) => ftPair(mr).home > 0));
reg("TEAM_TO_SCORE_YESNO_AWAY", ynHandler((mr) => ftPair(mr).away > 0));
reg("SCORING_DRAW", ynHandler((mr) => { const ft = ftPair(mr); return ft.home === ft.away && ft.home > 0; }));
reg("WIN_EITHER_HALF_HOME", ynHandler((mr) => { const f = firstHalfScores(mr), s = secondHalfScores(mr); return f.home > f.away || s.home > s.away; }, halvesCanEval));
reg("WIN_EITHER_HALF_AWAY", ynHandler((mr) => { const f = firstHalfScores(mr), s = secondHalfScores(mr); return f.away > f.home || s.away > s.home; }, halvesCanEval));

// --- Exact goals (total / home / away). Selection like "2" or "7+". ---
function exactGoalsValidate(params, ctx) {
  const raw = params?.count ?? params?.value ?? ctx?.label;
  const s = String(raw ?? "").trim();
  const m = s.match(/\d+/);
  if (!m) throw new ValidationError("invalid_count", { field: "count" });
  const plus = /\+|or\s*more/i.test(s);
  return { count: Number(m[0]), plus };
}
function exactGoalsHandler(which) {
  return {
    validate: exactGoalsValidate,
    canEvaluate: ftCanEval,
    evaluate(sel, mr) {
      const p = resolveParamsViaValidate(sel, exactGoalsValidate);
      if (p == null || !Number.isInteger(p.count)) {
        return { result: "VOID", reason: "invalid_selection" };
      }
      const ft = ftPair(mr);
      const n = which === "home" ? ft.home : which === "away" ? ft.away : ft.home + ft.away;
      const won = p.plus ? n >= p.count : n === p.count;
      return { result: won ? "WON" : "LOST" };
    },
  };
}
reg("EXACT_GOALS_FT", exactGoalsHandler("total"));
reg("EXACT_GOALS_HOME_FT", exactGoalsHandler("home"));
reg("EXACT_GOALS_AWAY_FT", exactGoalsHandler("away"));

// --- Highest scoring half (FIRST / SECOND / TIE) ---
function highHalfValidate(params, ctx) {
  const raw = params?.pick ?? params?.side ?? ctx?.label;
  const v = String(raw || "").trim().toUpperCase();
  let pick = null;
  if (/^1|FIRST|1ST/.test(v)) pick = "FIRST";
  else if (/^2|SECOND|2ND/.test(v)) pick = "SECOND";
  else if (/TIE|EQUAL|DRAW|SAME|^X$/.test(v)) pick = "TIE";
  if (!pick) throw new ValidationError("invalid_pick", { field: "pick" });
  return { pick };
}
reg("HIGHEST_SCORING_HALF", {
  validate: highHalfValidate,
  canEvaluate: halvesCanEval,
  evaluate(sel, mr) {
    const p = resolveParamsViaValidate(sel, highHalfValidate);
    if (!p?.pick) return { result: "VOID", reason: "invalid_selection_pick" };
    const f = firstHalfScores(mr), s = secondHalfScores(mr);
    const ftot = f.home + f.away, stot = s.home + s.away;
    const winner = ftot > stot ? "FIRST" : stot > ftot ? "SECOND" : "TIE";
    return { result: p.pick === winner ? "WON" : "LOST" };
  },
});

// --- Win both halves (side HOME / AWAY) ---
function sideValidate(params, ctx) {
  const raw = params?.side ?? params?.team ?? ctx?.label;
  const v = String(raw || "").trim().toUpperCase();
  const side = v === "HOME" || v === "1" ? "HOME" : v === "AWAY" || v === "2" ? "AWAY" : null;
  if (!side) throw new ValidationError("invalid_side", { field: "side" });
  return { side };
}
reg("WIN_BOTH_HALVES", {
  validate: sideValidate,
  canEvaluate: halvesCanEval,
  evaluate(sel, mr) {
    const p = resolveParamsViaValidate(sel, sideValidate);
    if (!p?.side) return { result: "VOID", reason: "invalid_selection_side" };
    const f = firstHalfScores(mr), s = secondHalfScores(mr);
    const winsBoth = p.side === "HOME"
      ? f.home > f.away && s.home > s.away
      : f.away > f.home && s.away > s.home;
    return { result: winsBoth ? "WON" : "LOST" };
  },
});

// --- Goal line (Asian total goals) — delegates to the overUnder grader,
//     which already handles quarter lines. ---
reg("GOAL_LINE_FT", {
  validate: overUnder.validate.bind(overUnder),
  canEvaluate: overUnder.canEvaluate.bind(overUnder),
  evaluate: overUnder.evaluate.bind(overUnder),
});

// ===========================================================================
// EVENT team-level markets (Stream 5). Read goal events (NOT player ids).
// Events are pre-sorted by minute. Own goals count for the BENEFITING team
// (opposite of the scoring player's team). VAR-overturned goals are excluded.
// Needs enrichment (events) → VOIDs fail-closed when absent; detectInconsistency
// already downgrades score/event-mismatch fixtures to PENDING, so we never grade
// against an incomplete goal timeline.
// ===========================================================================

const oppTeam = (t) => (t === "HOME" ? "AWAY" : t === "AWAY" ? "HOME" : null);
const creditedTeam = (e) => (e.flags?.ownGoal ? oppTeam(e.team) : e.team);
const realGoals = (mr) =>
  (mr?.events || []).filter((e) => e.type === "GOAL" && !e.flags?.varOverturned);

function teamScoreValidate(params, ctx) {
  const raw = params?.side ?? params?.pick ?? ctx?.label;
  const v = String(raw || "").trim().toUpperCase();
  let side = null;
  if (v === "HOME" || v === "1") side = "HOME";
  else if (v === "AWAY" || v === "2") side = "AWAY";
  else if (/^NONE|NO\s*GOAL|NEITHER|^NO$|^X$|^0$/.test(v)) side = "NONE";
  if (!side) throw new ValidationError("invalid_side", { field: "side" });
  return { side };
}
function teamGoalHandler(which) {
  return {
    validate: teamScoreValidate,
    canEvaluate: (mr) => Array.isArray(mr?.events) && ftPair(mr) != null,
    evaluate(sel, mr) {
      const p = resolveParamsViaValidate(sel, teamScoreValidate);
      if (!p?.side) return { result: "VOID", reason: "invalid_selection_side" };
      const goals = realGoals(mr);
      let winner = "NONE";
      if (goals.length) {
        const g = which === "first" ? goals[0] : goals[goals.length - 1];
        winner = creditedTeam(g) || "NONE";
      }
      return { result: p.side === winner ? "WON" : "LOST" };
    },
  };
}
reg("TEAM_FIRST_GOAL", teamGoalHandler("first"));
reg("FIRST_TEAM_SCORE", teamGoalHandler("first"));
reg("TEAM_LAST_GOAL", teamGoalHandler("last"));
reg("LAST_TEAM_SCORE", teamGoalHandler("last"));

// --- Team to score in a half (score-derived: HT scores / derived 2H). ---
const htCanEval = (mr) => firstHalfScores(mr) != null;
const shCanEval = (mr) => secondHalfScores(mr) != null;
reg("TEAM_TO_SCORE_YESNO_HOME_HT", ynHandler((mr) => firstHalfScores(mr).home > 0, htCanEval));
reg("TEAM_TO_SCORE_YESNO_AWAY_HT", ynHandler((mr) => firstHalfScores(mr).away > 0, htCanEval));
reg("TEAM_TO_SCORE_YESNO_HOME_SH", ynHandler((mr) => secondHalfScores(mr).home > 0, shCanEval));
reg("TEAM_TO_SCORE_YESNO_AWAY_SH", ynHandler((mr) => secondHalfScores(mr).away > 0, shCanEval));

// ===========================================================================
// STAT-derived market VARIANTS (Stream 2). Read per-team corner/card counts
// already stored in mr.stats, synthesize a "score" from them, and delegate to
// the proven goal-market graders (1X2 / handicap / team total). League-gated:
// the stat accessor returns null when the provider didn't report the stat
// (post the fail-closed normalizer), so canEvaluate=false → VOID, never a grade
// against fabricated zeros.
// ===========================================================================

function cornersStat(mr) {
  const c = mr?.stats?.corners;
  return c && Number.isInteger(c.home) && Number.isInteger(c.away)
    ? { home: c.home, away: c.away }
    : null;
}
function cardsStat(mr) {
  const c = mr?.stats?.cards;
  if (!c?.home || !c?.away) return null;
  const v = [c.home.yellow, c.home.red, c.away.yellow, c.away.red];
  if (!v.every(Number.isInteger)) return null;
  return { home: c.home.yellow + c.home.red, away: c.away.yellow + c.away.red };
}
// Build a synthetic match-result whose fullTime score IS the stat pair, so the
// goal-market graders apply unchanged.
function statSynth(mr, stat) {
  return { ...mr, scores: { ...mr.scores, fullTime: { home: stat.home, away: stat.away } } };
}
function statMarket(statAccessor, baseModule, inject) {
  return {
    validate: inject
      ? (p, ctx) => baseModule.validate({ ...(p || {}), ...inject }, ctx)
      : baseModule.validate.bind(baseModule),
    canEvaluate: (mr) => statAccessor(mr) != null,
    evaluate(sel, mr) {
      const stat = statAccessor(mr);
      if (!stat) return { result: "VOID", reason: "missing_required_data" };
      const sSel = inject
        ? { ...sel, market_params: { ...(sel.market_params || {}), ...inject } }
        : sel;
      return baseModule.evaluate(sSel, statSynth(mr, stat));
    },
  };
}

// Corners
reg("CORNERS_1X2_FT", statMarket(cornersStat, matchWinner));
reg("CORNERS_HANDICAP_ASIAN", statMarket(cornersStat, handicapAsian));
reg("CORNERS_TEAM_OU_HOME_FT", statMarket(cornersStat, teamTotal, { team: "HOME" }));
reg("CORNERS_TEAM_OU_AWAY_FT", statMarket(cornersStat, teamTotal, { team: "AWAY" }));
// Cards
reg("CARDS_1X2_FT", statMarket(cardsStat, matchWinner));
reg("CARDS_ASIAN_HANDICAP", statMarket(cardsStat, handicapAsian));
reg("CARDS_HANDICAP_EUROPEAN", statMarket(cardsStat, handicapEuropean));
reg("CARDS_TEAM_TOTAL_HOME", statMarket(cardsStat, teamTotal, { team: "HOME" }));
reg("CARDS_TEAM_TOTAL_AWAY", statMarket(cardsStat, teamTotal, { team: "AWAY" }));

// ===========================================================================
// STREAM 3 — additional team stats (offsides / fouls / saves / shots). All NEW
// canonical codes (auto-registered via catalogHandlerCodes). Read the per-team
// stat counts ingested by enrichFixtureResult; same league-gated fail-closed
// behavior (absent stat → null accessor → VOID, never a fabricated grade).
// ===========================================================================
function pairStat(key) {
  return (mr) => {
    const g = mr?.stats?.[key];
    return g && Number.isInteger(g.home) && Number.isInteger(g.away) ? g : null;
  };
}
// Full market family (total O/U, 1X2, team totals, handicap, odd/even) for one
// stat, via synth-score delegation to the proven goal-market graders.
function regStatFamily(prefix, accessor) {
  reg(`${prefix}_OVER_UNDER`, statMarket(accessor, overUnder));
  reg(`${prefix}_1X2`, statMarket(accessor, matchWinner));
  reg(`${prefix}_TEAM_HOME`, statMarket(accessor, teamTotal, { team: "HOME" }));
  reg(`${prefix}_TEAM_AWAY`, statMarket(accessor, teamTotal, { team: "AWAY" }));
  reg(`${prefix}_HANDICAP`, statMarket(accessor, handicapAsian));
  reg(`${prefix}_ODD_EVEN`, statMarket(accessor, oddEven));
}
regStatFamily("OFFSIDES", pairStat("offsides"));
regStatFamily("FOULS", pairStat("fouls"));
regStatFamily("SAVES", pairStat("saves"));
// Total shots (O/U + 1X2) and team shots-on-target (we already store on-target).
reg("SHOTS_OVER_UNDER", statMarket(pairStat("totalShots"), overUnder));
reg("SHOTS_1X2", statMarket(pairStat("totalShots"), matchWinner));
reg("SHOTS_ON_TARGET_TEAM_HOME", statMarket(pairStat("shotsOnTarget"), teamTotal, { team: "HOME" }));
reg("SHOTS_ON_TARGET_TEAM_AWAY", statMarket(pairStat("shotsOnTarget"), teamTotal, { team: "AWAY" }));

// ===========================================================================
// COMBINATION markets (popular for accumulators). Each is an AND of two FT-score
// sub-outcomes, graded by delegating to the base graders and requiring both to
// WIN. If either sub-leg VOIDs (push / missing score), the combo VOIDs. All read
// only the final score → universal data.
// ===========================================================================
const side3 = (s) => {
  const v = String(s || "").toLowerCase().trim();
  if (/\bhome\b|^1$/.test(v)) return "HOME";
  if (/\bdraw\b|^x$/.test(v)) return "DRAW";
  if (/\baway\b|^2$/.test(v)) return "AWAY";
  return null;
};
const ouOf = (s) => {
  const v = String(s || "").toLowerCase();
  if (/over|^o\b/.test(v)) return "OVER";
  if (/under|^u\b/.test(v)) return "UNDER";
  return null;
};
const bttsOf = (s) => {
  const v = String(s || "").toLowerCase().trim();
  if (/^y|yes|^gg/.test(v)) return "YES";
  if (/^n|no|^ng/.test(v)) return "NO";
  return null;
};
const numFrom = (s) => { const m = String(s || "").match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
// Both legs must WIN; any VOID/PENDING leg → combo VOID (never a wrong grade).
function combo(...rs) {
  if (rs.some((r) => r === "VOID" || r === "PENDING")) {
    return { result: "VOID", reason: "combo_leg_unresolved" };
  }
  return { result: rs.every((r) => r === "WON") ? "WON" : "LOST" };
}

// Result / Total Goals (e.g. "Home/Over 2.5")
function resultTotalValidate(params, ctx) {
  const parts = String(ctx?.label || "").split("/");
  const side = side3(params?.side ?? parts[0]);
  const ouSide = ouOf(params?.ouSide ?? parts[1]);
  const line = params?.line != null ? Number(params.line) : numFrom(parts[1]);
  if (!side || !ouSide || line == null || !Number.isFinite(line)) {
    throw new ValidationError("invalid_combo", { field: "combo" });
  }
  return { side, ouSide, line };
}
reg("RESULT_TOTAL_FT", {
  validate: resultTotalValidate,
  canEvaluate: ftCanEval,
  evaluate(sel, mr) {
    const p = resolveParamsViaValidate(sel, resultTotalValidate);
    if (!p) return { result: "VOID", reason: "invalid_combo" };
    return combo(
      matchWinner.evaluate({ market_params: { side: p.side } }, mr).result,
      overUnder.evaluate({ market_params: { side: p.ouSide, line: p.line } }, mr).result,
    );
  },
});

// Total Goals / Both Teams To Score (e.g. "Over 2.5/Yes")
function totalBttsValidate(params, ctx) {
  const parts = String(ctx?.label || "").split("/");
  const ouSide = ouOf(params?.ouSide ?? parts[0]);
  const line = params?.line != null ? Number(params.line) : numFrom(parts[0]);
  const bttsPick = bttsOf(params?.btts ?? parts[1]);
  if (!ouSide || line == null || !Number.isFinite(line) || !bttsPick) {
    throw new ValidationError("invalid_combo", { field: "combo" });
  }
  return { ouSide, line, btts: bttsPick };
}
reg("TOTAL_GOALS_BTTS", {
  validate: totalBttsValidate,
  canEvaluate: ftCanEval,
  evaluate(sel, mr) {
    const p = resolveParamsViaValidate(sel, totalBttsValidate);
    if (!p) return { result: "VOID", reason: "invalid_combo" };
    return combo(
      overUnder.evaluate({ market_params: { side: p.ouSide, line: p.line } }, mr).result,
      btts.evaluate({ market_params: { pick: p.btts } }, mr).result,
    );
  },
});

// Result / Both Teams Score (e.g. "Home/Yes")
function resultBttsValidate(params, ctx) {
  const parts = String(ctx?.label || "").split("/");
  const side = side3(params?.side ?? parts[0]);
  const bttsPick = bttsOf(params?.btts ?? parts[1]);
  if (!side || !bttsPick) throw new ValidationError("invalid_combo", { field: "combo" });
  return { side, btts: bttsPick };
}
reg("RESULT_BTTS_FT", {
  validate: resultBttsValidate,
  canEvaluate: ftCanEval,
  evaluate(sel, mr) {
    const p = resolveParamsViaValidate(sel, resultBttsValidate);
    if (!p) return { result: "VOID", reason: "invalid_combo" };
    return combo(
      matchWinner.evaluate({ market_params: { side: p.side } }, mr).result,
      btts.evaluate({ market_params: { pick: p.btts } }, mr).result,
    );
  },
});

// Win to Nil (generic: Home / Away / No). A team wins AND concedes 0; "No" =
// neither team wins to nil.
function winToNilValidate(params, ctx) {
  const v = String(params?.side ?? ctx?.label ?? "").toLowerCase().trim();
  let side = null;
  if (/\bhome\b|^1$/.test(v)) side = "HOME";
  else if (/\baway\b|^2$/.test(v)) side = "AWAY";
  else if (/\bno\b|neither|none/.test(v)) side = "NONE";
  if (!side) throw new ValidationError("invalid_side", { field: "side" });
  return { side };
}
reg("WIN_TO_NIL", {
  validate: winToNilValidate,
  canEvaluate: ftCanEval,
  evaluate(sel, mr) {
    const p = resolveParamsViaValidate(sel, winToNilValidate);
    if (!p?.side) return { result: "VOID", reason: "invalid_selection_side" };
    const ft = ftPair(mr);
    const homeWTN = ft.home > ft.away && ft.away === 0;
    const awayWTN = ft.away > ft.home && ft.home === 0;
    const won = p.side === "HOME" ? homeWTN : p.side === "AWAY" ? awayWTN : !homeWTN && !awayWTN;
    return { result: won ? "WON" : "LOST" };
  },
});

reg("APISPORTS_UNSUPPORTED_SPORT", {
  validate: (params) =>
    params && typeof params === "object" ? { ...params } : {},
  canEvaluate: () => true,
  evaluate: () => voidStub("unsupported_non_football_market"),
});

reg("APISPORTS_SPECIAL", {
  validate: (params) =>
    params && typeof params === "object" ? { ...params } : {},
  canEvaluate: () => true,
  evaluate(sel) {
    const id = sel.market_params?.apiBetId;
    return voidStub(
      id != null ? `apisports_special_bet_${id}` : "apisports_special_market",
    );
  },
});

/**
 * @param {string} code
 * @returns {boolean} true if this catalog code has an EXPLICIT reg() handler
 *   (real grading logic), vs. falling through to the VOID default. Lets callers
 *   distinguish a genuinely-gradable catalog market from a placeholder.
 */
export function catalogHasHandler(code) {
  return Boolean(HANDLERS[code]);
}

/** All codes with an explicit reg() handler. Used by the registry to auto-create
 *  a module for any handler code missing from the generated module list, so a
 *  reg() handler is never silently unsupported. */
export function catalogHandlerCodes() {
  return Object.keys(HANDLERS);
}

/**
 * @param {string} code
 * @param {object} params
 * @param {object} ctx
 */
export function catalogValidate(code, params, ctx) {
  const c = HANDLERS[code];
  if (c?.validate) return c.validate(params, ctx);
  if (!params || typeof params !== "object") {
    throw new ValidationError("invalid_params");
  }
  return { ...params };
}

/** @param {string} code @param {object} mr */
export function catalogCanEvaluate(code, mr) {
  const c = HANDLERS[code];
  if (c?.canEvaluate) return c.canEvaluate(mr);
  return Boolean(
    Number.isInteger(mr?.scores?.fullTime?.home) &&
      Number.isInteger(mr?.scores?.fullTime?.away),
  );
}

/** @param {string} code @param {object} sel @param {object} mr */
export function catalogEvaluate(code, sel, mr) {
  const c = HANDLERS[code];
  if (c?.evaluate) return c.evaluate(sel, mr);
  return voidStub("apisports_market_rules_pending");
}
