/**
 * Client-side accumulator % (must match `backend/lib/bonusEngine.js` computeAccumulatorPercent).
 *
 * @param {{ type?: string, percentage?: number, rules?: { tiers?: Array<{ minLegs: number, bonusPercent: number }> } } | null | undefined} bonusRow
 * @param {number} legCount
 */
export function accumulatorPercentFromPublicBonus(bonusRow, legCount) {
  if (!bonusRow || bonusRow.type !== "ACCUMULATOR") return 0;
  const n = Number(legCount);
  if (!Number.isFinite(n) || n < 1) return 0;
  const rules =
    bonusRow.rules && typeof bonusRow.rules === "object" ? bonusRow.rules : {};
  const tiers = Array.isArray(rules.tiers) ? rules.tiers : [];
  let best = 0;
  for (const t of tiers) {
    const minL = Number(t.minLegs);
    const bp = Number(t.bonusPercent);
    if (!Number.isFinite(minL) || !Number.isFinite(bp)) continue;
    if (n >= minL && bp > best) best = bp;
  }
  if (best === 0 && tiers.length === 0) {
    const p = Number(bonusRow.percentage);
    if (Number.isFinite(p) && p > 0 && n >= 2) return p;
  }
  return best;
}

/**
 * @param {Array<{ type?: string, percentage?: number, rules?: object }>} bonuses
 * @param {number} legCount
 */
export function accumulatorPercentFromBonusesList(bonuses, legCount) {
  const row = bonuses?.find((b) => b.type === "ACCUMULATOR");
  return accumulatorPercentFromPublicBonus(row, legCount);
}

export function potentialWinWithAccumulatorPercent(stake, oddsProduct, accPercent) {
  const s = Number(stake);
  const o = Number(oddsProduct);
  const p = Number(accPercent) || 0;
  if (!Number.isFinite(s) || !Number.isFinite(o)) return null;
  return (s * o * (1 + p / 100)).toFixed(2);
}

/**
 * Extra gross payout from accumulator % (before tax): stake × odds × (acc%/100).
 * Matches the delta between max win with vs without the bonus on gross.
 *
 * @returns {string | null} Two-decimal string, or null if not applicable
 */
export function accumulatorBonusExtraGrossFormatted(stake, oddsProduct, accPercent) {
  const s = Number(stake);
  const o = Number(oddsProduct);
  const p = Number(accPercent) || 0;
  if (p <= 0 || !Number.isFinite(s) || !Number.isFinite(o)) return null;
  return (s * o * (p / 100)).toFixed(2);
}
