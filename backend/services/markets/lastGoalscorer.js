import { ValidationError } from "./errors.js";

function validGoals(events) {
  return (events || []).filter(
    (e) =>
      e.type === "GOAL" &&
      !e.flags?.ownGoal &&
      !e.flags?.varOverturned,
  );
}

export default Object.freeze({
  code: "LAST_GOALSCORER",
  version: 1,
  aliases: ["LAST_SCORER"],
  description: "Player to score the last non-own, non-overturned goal",
  requiredResultFields: ["events", "scores.fullTime.home", "scores.fullTime.away"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "NONE",
  },

  validate(params) {
    const playerId = String(params?.playerId || "").trim();
    if (!playerId) {
      throw new ValidationError("missing_player_id", { field: "playerId" });
    }
    return { playerId };
  },

  canEvaluate(mr) {
    if (!Array.isArray(mr?.events)) return false;
    if (
      !Number.isInteger(mr?.scores?.fullTime?.home) ||
      !Number.isInteger(mr?.scores?.fullTime?.away)
    ) {
      return false;
    }
    const total = mr.scores.fullTime.home + mr.scores.fullTime.away;
    if (total === 0) return true;
    return validGoals(mr.events).length > 0;
  },

  evaluate(selection, mr) {
    const playerId = String(selection?.market_params?.playerId || "").trim();
    if (!playerId) return { result: "VOID", reason: "invalid_selection_player" };
    const goals = validGoals(mr.events);
    if (goals.length === 0) {
      const total = mr.scores.fullTime.home + mr.scores.fullTime.away;
      if (total === 0) return { result: "LOST" };
      return { result: "VOID", reason: "missing_goal_events" };
    }
    const last = goals[goals.length - 1];
    return { result: last?.scorer?.id === playerId ? "WON" : "LOST" };
  },
});
