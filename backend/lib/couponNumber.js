/** Random 5-digit zero-padded group. */
function randomFiveDigits() {
  return Math.floor(Math.random() * 100_000)
    .toString()
    .padStart(5, "0");
}

/** Unique human-facing id for offline lookup / printing — #####-##### (digits only). */
export function buildCouponNumber() {
  return `${randomFiveDigits()}-${randomFiveDigits()}`;
}

/**
 * @param {unknown} raw
 * @returns {{ compact: string, compactLower: string }}
 */
export function normalizeCouponLookupInput(raw) {
  let s = String(raw ?? "").normalize("NFKC");
  s = s.replace(/\ufeff/g, "").trim();
  s = s.replace(/[\u00a0\u200b-\u200d\ufeff]/g, "").trim();
  const compact = s.replace(/\s+/g, "");
  const compactLower = compact.toLowerCase();
  return { compact, compactLower };
}

/**
 * Unique DB values we should try against `coupon_number` (handles legacy casing quirks).
 *
 * @param {string} compact
 * @param {string} compactLower
 * @returns {string[]}
 */
export function couponLookupCandidates(compact, compactLower) {
  /** @type {string[]} */
  const out = [];
  const push = (v) => {
    const t = String(v || "").trim();
    if (!t || out.includes(t)) return;
    out.push(t);
  };
  push(compactLower);
  push(compact);
  // Numeric coupons are stored hyphenated (`#####-#####`). Accept input typed
  // without the hyphen (or with spaces) by matching both digit-only and
  // hyphen-grouped forms.
  const digits = compact.replace(/\D/g, "");
  if (digits.length === 10) {
    push(`${digits.slice(0, 5)}-${digits.slice(5)}`);
    push(digits);
  }
  return out;
}
