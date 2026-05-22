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
  code: "FIRST_GOALSCORER",
  version: 1,
  aliases: ["FIRST_SCORER"],
  description: "Player to score the first non-own, non-overturned goal",
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
    // 0-0 means no goal was scored: we can settle (all LOST) without events.
    if (total === 0) return true;
    // Otherwise we require at least one valid goal event to know "first scorer".
    return validGoals(mr.events).length > 0;
  },

  evaluate(selection, mr) {
    const playerId = String(selection?.market_params?.playerId || "").trim();
    if (!playerId) return { result: "VOID", reason: "invalid_selection_player" };
    const goals = validGoals(mr.events);
    if (goals.length === 0) {
      const total = mr.scores.fullTime.home + mr.scores.fullTime.away;
      if (total === 0) {
        // "No goalscorer" market is a separate code; anyone chosen here LOSES.
        return { result: "LOST" };
      }
      return { result: "VOID", reason: "missing_goal_events" };
    }
    // Goals are already sorted by (minute, id) in the normalizer.
    const first = goals[0];
    return { result: first?.scorer?.id === playerId ? "WON" : "LOST" };
  },
});
