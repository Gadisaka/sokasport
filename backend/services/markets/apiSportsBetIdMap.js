/**
 * API-Sports `odds/bets` catalogue ↔ internal canonical market codes.
 *
 * Source of truth for numeric identifiers: `backend/markets.md`
 * Regenerated via `node scripts/generateApiSportsBetMap.mjs` →
 * `apiSportsBetIdMap.generated.js`.
 *
 * IMPORTANT — placement ambiguity rule:
 * When `marketCode` is **digits-only**, it is ALWAYS interpreted as an
 * API-Sports **bet id** first (see generated map). This avoids clashes
 * with legacy aliases such as `"2"` meaning AWAY on 1X2. To place a 1X2
 * Away selection when bet id 2 exists, send canonical `MATCH_WINNER` +
 * `{ side: "AWAY" }`, not `marketCode: "2"`.
 *
 * @module services/markets/apiSportsBetIdMap
 */

export {
  API_SPORTS_BET_ID_TO_CANONICAL,
  API_SPORTS_CANONICAL_CODES,
  API_SPORTS_BET_IDS,
} from "./apiSportsBetIdMap.generated.js";

import { API_SPORTS_BET_ID_TO_CANONICAL } from "./apiSportsBetIdMap.generated.js";

/**
 * @param {string|number} raw
 * @returns {{ canonical: string, apiBetId: number } | null}
 */
export function tryResolveNumericBetId(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const id = Number(s);
  if (!Number.isInteger(id) || id <= 0) return null;
  const canonical = API_SPORTS_BET_ID_TO_CANONICAL[id];
  return canonical ? { canonical, apiBetId: id } : null;
}

/**
 * Placement / alias resolution: digits-only API bet ids and `BET_123` style refs.
 * @returns {{ canonical: string, apiBetId: number } | null}
 */
export function tryResolveMarketCodeBetId(raw) {
  const numeric = tryResolveNumericBetId(raw);
  if (numeric) return numeric;
  const s = String(raw ?? "").trim();
  const m = /^BET[_-]?(\d+)$/i.exec(s);
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isInteger(id) || id <= 0) return null;
  const canonical = API_SPORTS_BET_ID_TO_CANONICAL[id];
  return canonical ? { canonical, apiBetId: id } : null;
}

/** @param {number} id */
export function canonicalCodeForBetId(id) {
  return API_SPORTS_BET_ID_TO_CANONICAL[id] ?? null;
}
