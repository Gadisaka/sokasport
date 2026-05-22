/**
 * Map GET /api/cms/ticket-by-coupon selection legs to bet slip rows (matches placeBet / MatchesTable payloads).
 */

function safeSlug(s) {
  return String(s || "")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Last selection wins per apiFixtureId (slip UX is one leg per fixture).
 *
 * @param {string} couponNumber
 * @param {Array<Record<string, unknown>>} selections
 */
export function mapCouponSelectionsToSlipRows(couponNumber, selections = []) {
  const coupon = safeSlug(couponNumber) || "coupon";

  /** @type {Map<number|string, Record<string, unknown>>} */
  const byFixture = new Map();

  (Array.isArray(selections) ? selections : []).forEach((sel, idx) => {
    const oddsNum = Number(sel?.odds);
    const value =
      Number.isFinite(oddsNum) ? String(oddsNum.toFixed(2)) : "";

    const matchName = safeSlug(sel?.matchName) || "Match";
    const marketLabel = safeSlug(sel?.marketLabel) || "Market";
    const label = String(sel?.label || "").trim() || "?";

    const apiRaw = sel?.apiFixtureId;
    const apiFixtureId =
      apiRaw != null && Number.isFinite(Number(apiRaw)) ? Number(apiRaw) : null;

    const id =
      apiFixtureId != null
        ? `${matchName}-${marketLabel}-${label}-coupon:${coupon}:${apiFixtureId}`
        : `${matchName}-${marketLabel}-${label}-coupon:${coupon}:${idx}`;

    const row = {
      id,
      apiFixtureId,
      matchName,
      marketLabel,
      label,
      value,
      marketCode: sel?.marketCode ?? null,
      marketParams: sel?.marketParams ?? null,
      kickoffAt: sel?.kickoffAt ?? null,
      matchStatus: sel?.matchStatus ?? null,
      fromLive: false,
    };

    if (apiFixtureId != null) {
      byFixture.set(apiFixtureId, row);
    } else {
      byFixture.set(`__n${idx}`, row);
    }
  });

  return [...byFixture.values()];
}
