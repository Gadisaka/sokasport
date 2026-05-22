/**
 * Handlers for API-Sports catalogue markets (see apiSportsBetIdMap.generated.js).
 * Codes without an explicit entry use FT-score defaults or VOID pending rules.
 *
 * @module services/markets/apiSportsCatalogHandlers
 */
import { ValidationError } from "./errors.js";
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
