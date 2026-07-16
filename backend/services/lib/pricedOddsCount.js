/**
 * Unique priced odd selections (market × selection label), matching the
 * frontend `toCategoryOdds` bookmaker dedupe. Multi-bookmaker rows for the
 * same market + value count once.
 *
 * @param {Array<{ market_id?: string, value?: string, odd?: number }>} lines
 * @returns {number}
 */
export function countUniquePricedSelections(lines = []) {
  const seen = new Set();
  for (const line of lines) {
    const odd = Number(line?.odd);
    if (!Number.isFinite(odd) || odd <= 0) continue;
    const value = String(line?.value ?? "")
      .trim()
      .toLowerCase();
    if (!value) continue;
    const marketId = line?.market_id;
    if (!marketId) continue;
    seen.add(`${marketId}\0${value}`);
  }
  return seen.size;
}
