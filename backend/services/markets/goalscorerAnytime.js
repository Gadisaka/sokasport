import { ValidationError } from "./errors.js";

export default Object.freeze({
  code: "GOALSCORER_ANYTIME",
  version: 1,
  aliases: ["ANYTIME_GOALSCORER", "ANY_TIME_SCORER"],
  description: "Player to score any goal in regulation (excludes own goals)",
  requiredResultFields: ["events"],
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
    const playerName = params?.playerName ? String(params.playerName).trim() : null;
    return { playerId, playerName };
  },

  canEvaluate(mr) {
    // Events must be a non-null array. Empty means "no goals scored"
    // which is a valid LOST outcome.
    return Array.isArray(mr?.events);
  },

  evaluate(selection, mr) {
    const playerId = String(selection?.market_params?.playerId || "").trim();
    if (!playerId) return { result: "VOID", reason: "invalid_selection_player" };
    const scored = mr.events.some(
      (e) =>
        e.type === "GOAL" &&
        !e.flags?.ownGoal &&
        !e.flags?.varOverturned &&
        e.scorer?.id === playerId,
    );
    return { result: scored ? "WON" : "LOST" };
  },
});
