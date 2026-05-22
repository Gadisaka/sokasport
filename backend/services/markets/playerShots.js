import { ValidationError } from "./errors.js";

function normalizeSide(raw) {
  const key = String(raw || "").trim().toUpperCase();
  if (key === "OVER" || key === "O") return "OVER";
  if (key === "UNDER" || key === "U") return "UNDER";
  return null;
}

function normalizeLine(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const scaled = Math.round(n * 4);
  if (Math.abs(n * 4 - scaled) > 1e-9) return null;
  const line = scaled / 4;
  return line >= 0 ? line : null;
}

export default Object.freeze({
  code: "PLAYER_SHOTS",
  version: 1,
  aliases: ["PLAYER_SHOTS_ON_TARGET", "PLAYER_TOTAL_SHOTS"],
  description:
    "Player shots (on target or total) over / under. Requires per-player stats payload keyed by playerId.",
  requiredResultFields: ["stats.players"],
  settlePolicy: {
    voidOnVoidFixture: true,
    voidOnAwardedWithoutScores: true,
    pushPolicy: "VOID",
  },

  validate(params) {
    const playerId = String(params?.playerId || "").trim();
    if (!playerId) throw new ValidationError("missing_player_id", { field: "playerId" });
    const side = normalizeSide(params?.side);
    if (!side) throw new ValidationError("invalid_side", { field: "side" });
    const line = normalizeLine(params?.line ?? params?.value);
    if (line === null) throw new ValidationError("invalid_line", { field: "line" });
    const scope = String(params?.scope || "ON_TARGET").toUpperCase();
    if (!["ON_TARGET", "TOTAL"].includes(scope)) {
      throw new ValidationError("invalid_scope", { field: "scope" });
    }
    return { playerId, side, line, scope };
  },

  canEvaluate(mr) {
    // Requires per-player stat entries. Absent when provider lacks them
    // → engine will downgrade to VOID / missing_required_data.
    return Boolean(mr?.stats?.players) && typeof mr.stats.players === "object";
  },

  evaluate(selection, mr) {
    const { playerId, side, line, scope } = selection?.market_params || {};
    const normSide = normalizeSide(side);
    const normLine = normalizeLine(line);
    if (!playerId || !normSide || normLine === null) {
      return { result: "VOID", reason: "invalid_selection_params" };
    }
    const player = mr.stats.players[playerId];
    if (!player) return { result: "VOID", reason: "player_not_found" };
    const actual =
      scope === "TOTAL"
        ? Number(player.shotsTotal)
        : Number(player.shotsOnTarget);
    if (!Number.isFinite(actual)) {
      return { result: "VOID", reason: "missing_shot_stats" };
    }
    if (actual === normLine) return { result: "VOID", reason: "push" };
    const isOver = actual > normLine;
    return { result: (normSide === "OVER") === isOver ? "WON" : "LOST" };
  },
});
