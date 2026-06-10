import { compareOddsDrift } from "./compareOdds.js";
import { normalizePlacementSelections } from "./normalize.js";
import { resolveLiveOdds } from "./resolveLiveOdds.js";
import { resolvePrematchOdds } from "./resolveOdds.js";
import { getOddsTolerance } from "./tolerance.js";
import { writeFreezeSnapshot } from "./freeze.js";
import { recordValidationMetric } from "../../lib/validationMetrics.js";

function hasBlockingState(row) {
  const state = String(row.marketState || "").toUpperCase();
  if (state === "LOCKED") return "market_locked";
  if (state === "SUSPENDED" || state === "CLOSED") return "market_suspended";
  return null;
}

export async function validatePlacementSelections({
  prismaClient,
  rawSelections = [],
  live = false,
  actorId = null,
  now = new Date(),
  writeFreeze = false,
}) {
  const startedAt = Date.now();
  const selections = normalizePlacementSelections(rawSelections, {
    allowAnyOdds: live,
  });
  if (!selections.length) {
    recordValidationMetric({
      channel: live ? "live" : "prematch",
      code: "invalid_selections",
      latencyMs: Date.now() - startedAt,
    });
    return {
      ok: false,
      code: "invalid_selections",
      selections: [],
    };
  }

  const resolved = live
    ? await resolveLiveOdds({ prismaClient, selections, now })
    : await resolvePrematchOdds({ prismaClient, selections, now });

  for (const row of resolved) {
    if (row.code === "unknown_fixture") {
      recordValidationMetric({
        channel: live ? "live" : "prematch",
        code: "unknown_fixture",
        latencyMs: Date.now() - startedAt,
      });
      return {
        ok: false,
        code: "unknown_fixture",
        selections: [{ index: row.index }],
      };
    }
    if (!live && row.started) {
      recordValidationMetric({
        channel: "prematch",
        code: "fixture_started",
        latencyMs: Date.now() - startedAt,
      });
      return {
        ok: false,
        code: "fixture_started",
        selections: [{ index: row.index, kickoffAt: row.kickoffAt }],
      };
    }
    const blockedCode = hasBlockingState(row);
    if (blockedCode) {
      recordValidationMetric({
        channel: live ? "live" : "prematch",
        code: blockedCode,
        latencyMs: Date.now() - startedAt,
      });
      return {
        ok: false,
        code: blockedCode,
        selections: [{ index: row.index }],
      };
    }
  }

  const tolerance = getOddsTolerance({
    live,
    selectionsCount: selections.length,
  });
  const driftResult = live
    ? { oddsChanges: [], versionChanges: [] }
    : compareOddsDrift({
        selections,
        resolved,
        tolerance,
      });
  const oddsDrift = driftResult.oddsChanges || [];
  const versionDrift = driftResult.versionChanges || [];

  const totalOdds = resolved.reduce((acc, row) => acc * Number(row.serverOdds || 1), 1);

  const freezeToken =
    writeFreeze && actorId
      ? await writeFreezeSnapshot({
          actorId,
          selections,
          resolved,
          ttlSeconds: 5,
        })
      : null;

  const code = versionDrift.length
    ? "market_version_changed"
    : oddsDrift.length
      ? "odds_changed"
      : "ok";
  recordValidationMetric({
    channel: live ? "live" : "prematch",
    code,
    latencyMs: Date.now() - startedAt,
  });

  return {
    ok: code === "ok",
    code,
    selections,
    resolved,
    drift: oddsDrift,
    versionDrift,
    totalOdds,
    tolerance,
    freezeToken,
  };
}

/**
 * Collect every prematch leg that would block print/sell (not odds drift).
 *
 * @returns {Promise<Array<{ index: number, code: string, kickoffAt?: string|null }>>}
 */
export async function collectBlockingPlacementLegs({
  prismaClient,
  rawSelections = [],
  live = false,
  now = new Date(),
}) {
  const selections = normalizePlacementSelections(rawSelections, {
    allowAnyOdds: live,
  });
  if (!selections.length) return [];

  const resolved = live
    ? await resolveLiveOdds({ prismaClient, selections, now })
    : await resolvePrematchOdds({ prismaClient, selections, now });

  const blocking = [];
  for (const row of resolved) {
    if (row.code === "unknown_fixture") {
      blocking.push({ index: row.index, code: "unknown_fixture" });
      continue;
    }
    if (!live && row.started) {
      blocking.push({
        index: row.index,
        code: "fixture_started",
        kickoffAt: row.kickoffAt ?? null,
      });
      continue;
    }
    const blockedCode = hasBlockingState(row);
    if (blockedCode) {
      blocking.push({ index: row.index, code: blockedCode });
    }
  }
  return blocking;
}
