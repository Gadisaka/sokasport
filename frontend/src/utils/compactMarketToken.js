// Maps a compact six-cell strip token (1/x/2/1x/x2/12) to the correct market
// metadata. The strip mixes two markets: 1/x/2 = Match Winner, 1x/x2/12 =
// Double Chance. Sending marketCode + marketParams lets the backend route and
// settle the leg correctly instead of treating a DC pick as a Match Winner side.
const MATCH_WINNER_SIDE = { "1": "HOME", x: "DRAW", "2": "AWAY" };
const DC_COMBINATION = { "1x": "1X", x2: "X2", "12": "12" };

/**
 * @param {string} tokenId one of "1","x","2","1x","x2","12" (case-insensitive)
 * @returns {{ marketLabel: string, marketCode: string, marketParams: object, label: string } | null}
 *   null for unknown tokens so callers can fall back to existing behavior.
 */
export function resolveCompactMarketToken(tokenId) {
  const id = String(tokenId || "").toLowerCase();
  if (id in MATCH_WINNER_SIDE) {
    return {
      marketLabel: "Match Winner",
      marketCode: "MATCH_WINNER",
      marketParams: { side: MATCH_WINNER_SIDE[id] },
      label: id.toUpperCase(), // "1" | "X" | "2"
    };
  }
  if (id in DC_COMBINATION) {
    const combination = DC_COMBINATION[id];
    return {
      marketLabel: "Double Chance",
      marketCode: "DOUBLE_CHANCE",
      marketParams: { combination },
      label: combination, // "1X" | "X2" | "12"
    };
  }
  return null;
}
