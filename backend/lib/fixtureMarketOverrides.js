/**
 * Per-market manual winner overrides for fixture settlement.
 *
 * @module lib/fixtureMarketOverrides
 */
import { SELECTION_RESULT } from "../services/marketEvaluator.js";

export const OVERRIDE_PAYLOAD_VERSION = 1;

/**
 * Stable key for market_code + market_params.
 *
 * @param {string|null|undefined} marketCode
 * @param {object|null|undefined} marketParams
 */
export function buildOverrideKey(marketCode, marketParams = null) {
  const code = String(marketCode || "UNKNOWN").toUpperCase().trim();
  const params =
    marketParams && typeof marketParams === "object" ? marketParams : {};
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});
  return `${code}::${JSON.stringify(sorted)}`;
}

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * @param {object|null|undefined} raw
 */
export function normalizeOverridePayload(raw) {
  if (!raw || typeof raw !== "object") {
    return { version: OVERRIDE_PAYLOAD_VERSION, markets: {} };
  }
  const markets =
    raw.markets && typeof raw.markets === "object" ? raw.markets : {};
  return {
    version: raw.version || OVERRIDE_PAYLOAD_VERSION,
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || null,
    markets,
  };
}

/**
 * @param {object} selection - TicketSelection row
 * @param {object|null|undefined} overridePayload - normalized payload
 * @returns {{ result: string, reason: string, engineVersion: number, marketVersion: number } | null}
 */
export function gradeSelectionWithOverride(selection, overridePayload) {
  const payload = normalizeOverridePayload(overridePayload);
  const code = selection?.market_code;
  if (!code) return null;

  const key = buildOverrideKey(code, selection.market_params);
  const entry = payload.markets[key];
  if (!entry || !Array.isArray(entry.winningSelections)) return null;

  const winners = new Set(
    entry.winningSelections.map((s) => normalizeLabel(s)).filter(Boolean),
  );
  if (!winners.size) return null;

  const actual = normalizeLabel(selection.selection);
  const won = winners.has(actual);

  return {
    result: won ? SELECTION_RESULT.WON : SELECTION_RESULT.LOST,
    reason: "admin_market_override",
    engineVersion: 0,
    marketVersion: 0,
  };
}

/**
 * Build override payload from PATCH body map.
 *
 * @param {Record<string, { winningSelections?: string[], marketCode?: string, marketParams?: object, marketLabel?: string }>} marketOverrides
 * @param {string|null} userId
 */
export function buildOverridePayloadFromInput(marketOverrides, userId = null) {
  const markets = {};
  for (const [key, entry] of Object.entries(marketOverrides || {})) {
    if (!entry || !Array.isArray(entry.winningSelections)) continue;
    const marketCode = entry.marketCode || key.split("::")[0];
    const marketParams = entry.marketParams ?? null;
    const stableKey = buildOverrideKey(marketCode, marketParams);
    markets[stableKey] = {
      marketCode: String(marketCode || "").toUpperCase(),
      marketParams,
      marketLabel: entry.marketLabel || null,
      winningSelections: entry.winningSelections,
    };
  }
  return {
    version: OVERRIDE_PAYLOAD_VERSION,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
    markets,
  };
}
