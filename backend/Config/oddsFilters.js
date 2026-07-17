/**
 * Centralized odds-ingestion filters.
 *
 * Goal: reduce the volume of bookmaker × market × value writes that the
 * sync jobs persist to MongoDB. Two knobs are exposed:
 *
 *   1. **Bookmaker filtering (preferred + fallback chain)**
 *      Resolved at runtime by `services/settingsService.getPreferredBookmakerApiId`.
 *      Optional `BOOKMAKER_FALLBACK_CHAIN` tries additional API ids when the
 *      preferred row has no priced markets after filtering.
 *      Falls back to `DEFAULT_BOOKMAKER_API_ID` when no preference is set.
 *      When preferred is set but BOOKMAKER_FALLBACK_CHAIN is empty, uses
 *      DEFAULT_BOOKMAKER_FALLBACK_CHAIN so lower-tier leagues still get lines.
 *      If no preference and no env defaults, persistence stays unfiltered (legacy).
 *
 *   2. **Market name allowlist (opt-in)**
 *      Optional, env-driven via `ODDS_ALLOWED_MARKETS` (comma-separated).
 *
 * Backward-compatible: every value below has a "do nothing" sentinel.
 */

import {
  parseBookmakerFallbackChain,
  DEFAULT_BOOKMAKER_FALLBACK_CHAIN,
} from "./ingestionConfig.js";

function parseList(envValue) {
  if (!envValue) return null;
  const list = envValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? new Set(list) : null;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const v = String(raw).trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

/**
 * After preferred + BOOKMAKER_FALLBACK_CHAIN yield no priced markets,
 * take the first remaining bookmaker in the API response. Default on.
 */
export function isAnyBookmakerFallthroughEnabled() {
  return envBool("BOOKMAKER_ANY_FALLTHROUGH", true);
}

/**
 * Optional market-name allowlist. `null` means "persist every market".
 */
export const ALLOWED_MARKETS = parseList(process.env.ODDS_ALLOWED_MARKETS);

const fallbackId = Number.parseInt(
  process.env.DEFAULT_BOOKMAKER_API_ID || "",
  10,
);
export const DEFAULT_BOOKMAKER_API_ID = Number.isFinite(fallbackId)
  ? fallbackId
  : null;

/**
 * Build the parser options for a given preferred bookmaker id.
 *
 * @param {number|null} preferredApiId - resolved from settings (null if unset)
 */
export function buildOddsParseOptions(preferredApiId) {
  const chainEnv = parseBookmakerFallbackChain();
  /** @type {number[]} */
  const ordered = [];
  const pushUnique = (/** @type {number|null|undefined} */ id) => {
    if (id == null) return;
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0) return;
    if (!ordered.includes(n)) ordered.push(n);
  };

  pushUnique(preferredApiId);
  for (const id of chainEnv) pushUnique(id);
  // When only the preferred id is configured, still try common fallbacks so
  // fixtures in leagues without preferred-bookmaker coverage get priced lines.
  if (
    preferredApiId != null &&
    chainEnv.length === 0 &&
    ordered.length <= 1
  ) {
    for (const id of DEFAULT_BOOKMAKER_FALLBACK_CHAIN) pushUnique(id);
  }
  pushUnique(DEFAULT_BOOKMAKER_API_ID);

  const legacyPersistAllBookmakers = ordered.length === 0;

  const effectiveSingle =
    preferredApiId ?? DEFAULT_BOOKMAKER_API_ID ?? ordered[0] ?? null;

  return {
    orderedBookmakerApiIds: legacyPersistAllBookmakers ? null : ordered,
    /** Legacy shape: entire Set when multi-id fallback enabled — parser ignores for ordered path. */
    allowedBookmakerApiIds: legacyPersistAllBookmakers
      ? null
      : new Set(ordered),
    allowedMarketNames: ALLOWED_MARKETS,
    effectiveBookmakerApiId: effectiveSingle,
    legacyPersistAllBookmakers,
    anyBookmakerFallthrough:
      !legacyPersistAllBookmakers && isAnyBookmakerFallthroughEnabled(),
  };
}
