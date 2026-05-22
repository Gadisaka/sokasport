import { ValidationError } from "./errors.js";

function normalizePick(raw) {
  const key = String(raw || "").trim().toUpperCase();
  if (key === "YELLOW" || key === "Y" || key === "YELLOW_CARD") return "YELLOW_OR_RED";
  if (key === "YELLOW_OR_RED") return "YELLOW_OR_RED";
  if (key === "RED" || key === "R" || key === "RED_CARD") return "RED";
  if (key === "NO_CARD" || key === "NONE") return "NONE";
  return null;
}

export default Object.freeze({
  code: "PLAYER_CARDS",
  version: 1,
  aliases: ["PLAYER_TO_BE_CARDED", "PLAYER_CARD"],
  description: "Will a specific player receive a card / red card / no card",
  requiredResultFields: ["events"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "NONE",
  },

  validate(params) {
    const playerId = String(params?.playerId || "").trim();
    if (!playerId) throw new ValidationError("missing_player_id", { field: "playerId" });
    const pick = normalizePick(params?.pick);
    if (!pick) throw new ValidationError("invalid_pick", { field: "pick" });
    return { playerId, pick };
  },

  canEvaluate(mr) {
    return Array.isArray(mr?.events);
  },

  evaluate(selection, mr) {
    const playerId = String(selection?.market_params?.playerId || "").trim();
    const pick = normalizePick(selection?.market_params?.pick);
    if (!playerId || !pick) {
      return { result: "VOID", reason: "invalid_selection_params" };
    }
    const playerCards = mr.events.filter(
      (e) => e.type === "CARD" && e.player?.id === playerId,
    );
    const hasYellow = playerCards.some((e) => e.color === "YELLOW");
    const hasRed = playerCards.some(
      (e) => e.color === "RED" || e.color === "SECOND_YELLOW",
    );
    const hasAny = hasYellow || hasRed;

    if (pick === "NONE") {
      return { result: !hasAny ? "WON" : "LOST" };
    }
    if (pick === "RED") {
      return { result: hasRed ? "WON" : "LOST" };
    }
    // YELLOW_OR_RED: any card counts.
    return { result: hasAny ? "WON" : "LOST" };
  },
});
