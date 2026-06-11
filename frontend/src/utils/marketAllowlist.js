// Frontend DEFENSIVE market gate.
//
// The BACKEND is authoritative and phase-aware: the odds endpoints already strip
// every market not in the active allowlist phase (server-side, non-bypassable),
// so whatever reaches the client is already phase-correct. This frontend layer
// is therefore NOT an independent allow-list to keep in sync with backend phases
// — it is only a belt-and-suspenders block against obviously mis-mapped names
// (stat/period/compound variants that would settle WRONG) in case a stale cache
// serves something the backend would now strip. Default: allow (trust backend),
// hide only on a mis-map signal.

// A market NAME that would settle WRONG if it slipped through: a base goals/result
// market qualified by a different stat, but NOT one of the explicitly-supported
// period/stat markets the backend may legitimately serve (HT result, corners O/U,
// cards O/U, etc.). We keep this conservative — only block clear danger tokens
// that are NOT part of a supported market name.
const DANGER_TOKENS =
  /offside|foul|save|tackle|passes|booking|shootout|penalt|extra time|\(et\)|interval| minute|between \d|race to|method|\d(st|nd|rd|th) (goal|corner)|sent off/i;

/**
 * @param {string} name provider market display name (category)
 * @returns {boolean} true unless the name carries a clear mis-map / unsupported
 *   signal. Backend remains the real gate; this only catches stale-cache leaks.
 */
export function isAllowedMarketName(name) {
  const raw = String(name || "").toLowerCase().trim();
  if (!raw) return false;
  if (DANGER_TOKENS.test(raw)) return false;
  return true;
}

/** Filter an array of `{ category | name, ... }` market groups to allowed ones. */
export function filterAllowedMarkets(markets) {
  if (!Array.isArray(markets)) return [];
  return markets.filter((m) => isAllowedMarketName(m?.category ?? m?.name));
}
