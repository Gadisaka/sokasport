/**
 * Build market groups for admin fixture edit UI.
 *
 * @module services/adminFixtureMarketGroups
 */
import { inferMarketCode } from "./marketEvaluator.js";
import {
  buildOverrideKey,
  normalizeOverridePayload,
} from "../lib/fixtureMarketOverrides.js";

function stableParams(params) {
  if (!params || typeof params !== "object") return null;
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});
  return Object.keys(sorted).length ? sorted : null;
}

function addOption(group, label) {
  const value = String(label || "").trim();
  if (!value) return;
  if (!group.selectionOptions.includes(value)) {
    group.selectionOptions.push(value);
  }
}

/**
 * @param {object} fixture - prisma fixture with markets.odd_lines
 * @param {object[]} ticketSelections
 */
export function buildMarketGroupsForFixture(fixture, ticketSelections = []) {
  const groups = new Map();
  const overrides = normalizeOverridePayload(fixture.market_result_overrides);

  function ensureGroup(marketCode, marketParams, marketLabel) {
    const code = marketCode || "UNKNOWN";
    const params = stableParams(marketParams);
    const key = buildOverrideKey(code, params);
    if (!groups.has(key)) {
      const entry = overrides.markets[key];
      groups.set(key, {
        key,
        marketCode: code,
        marketParams: params,
        marketLabel: marketLabel || code,
        selectionOptions: [],
        ticketLegCount: 0,
        currentOverride: entry
          ? { winningSelections: entry.winningSelections || [] }
          : null,
        legacy: code === "UNKNOWN",
      });
    }
    return groups.get(key);
  }

  for (const sel of ticketSelections) {
    const code =
      sel.market_code ||
      inferMarketCode({
        market_code: sel.market_code,
        selection: sel.selection,
      }) ||
      "UNKNOWN";
    const params = stableParams(sel.market_params);
    const label = code;
    const group = ensureGroup(code, params, label);
    group.ticketLegCount += 1;
    addOption(group, sel.selection);
  }

  for (const market of fixture.markets || []) {
    const code =
      inferMarketCode({ marketLabel: market.name }) || market.name;
    const group = ensureGroup(code, null, market.name);
    for (const line of market.odd_lines || []) {
      addOption(group, line.value);
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (b.ticketLegCount !== a.ticketLegCount) {
      return b.ticketLegCount - a.ticketLegCount;
    }
    return a.marketLabel.localeCompare(b.marketLabel);
  });
}
