import { getRedisClient } from "../cacheService.js";
import {
  buildMarketNameCandidates,
  buildSelectionCandidates,
  resolvePrematchOdds,
} from "./resolveOdds.js";
import { resolveMarketState } from "./marketState.js";

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function buildLiveFieldCandidates(selection) {
  const markets = buildMarketNameCandidates({
    marketLabel: selection.marketLabel,
    marketCode: selection.marketCode,
  });
  const legacyMarket = selection.marketCode || selection.marketLabel || "";
  if (legacyMarket && !markets.includes(legacyMarket)) {
    markets.push(legacyMarket);
  }
  const labels = buildSelectionCandidates({
    selectionLabel: selection.label,
    marketCode: selection.marketCode,
    marketParams: selection.marketParams,
  });
  const fields = [];
  for (const market of markets) {
    for (const label of labels) {
      const key = `${market}|${label}`;
      if (!fields.includes(key)) fields.push(key);
    }
  }
  return fields;
}

async function hgetFirst(redis, key, fields) {
  for (const field of fields) {
    const raw = await redis.hget(key, field);
    if (raw !== null && raw !== undefined && raw !== "") {
      return { value: raw, field };
    }
  }
  return { value: null, field: null };
}

export async function resolveLiveOdds({
  prismaClient,
  selections = [],
  now = new Date(),
}) {
  const redis = getRedisClient();
  const liveRows = await Promise.all(
    selections.map(async (sel) => {
      const oddsKey = `live-odds:${sel.apiFixtureId}`;
      const stateKey = `live-market-state:${sel.apiFixtureId}`;
      const versionKey = `live-market-version:${sel.apiFixtureId}`;
      const updatedAtKey = `live-market-updated-at:${sel.apiFixtureId}`;
      const lockUntilKey = `live-market-lock-until:${sel.apiFixtureId}`;
      const fieldCandidates = buildLiveFieldCandidates(sel);
      const odds = await hgetFirst(redis, oddsKey, fieldCandidates);
      const matchedField = odds.field;
      const lookupFields = matchedField ? [matchedField] : fieldCandidates;
      const state = await hgetFirst(redis, stateKey, lookupFields);
      const version = await hgetFirst(redis, versionKey, lookupFields);
      const updatedAt = await hgetFirst(redis, updatedAtKey, lookupFields);
      const lockUntil = await hgetFirst(redis, lockUntilKey, lookupFields);
      const lockUntilNum = safeNumber(lockUntil.value);
      return {
        index: sel.index,
        apiFixtureId: sel.apiFixtureId,
        redisOdds: safeNumber(odds.value),
        redisState:
          String(state.value || "")
            .trim()
            .toUpperCase() || null,
        redisVersion: safeNumber(version.value),
        redisUpdatedAt: updatedAt.value || null,
        lockRemainingMs: Number.isFinite(lockUntilNum)
          ? Math.max(0, lockUntilNum - Date.now())
          : 0,
      };
    }),
  );

  const redisByIndex = new Map(liveRows.map((row) => [row.index, row]));
  const fallback = await resolvePrematchOdds({
    prismaClient,
    selections,
    now,
  });

  return fallback.map((row) => {
    const redisRow = redisByIndex.get(row.index);
    const hasRedis =
      Number.isFinite(redisRow?.redisOdds) && redisRow.redisOdds > 1;
    const hasDbFallback =
      Number.isFinite(row.serverOdds) && row.serverOdds > 1;
    const serverOdds = hasRedis
      ? redisRow.redisOdds
      : hasDbFallback
        ? row.serverOdds
        : NaN;
    return {
      ...row,
      serverOdds,
      marketState: resolveMarketState({
        fixtureStatus: row.fixtureStatus,
        hasOddLine: hasRedis || hasDbFallback,
        operatorState: redisRow?.redisState || row.marketState,
      }),
      lockRemainingMs: Math.max(0, Number(redisRow?.lockRemainingMs || 0)),
      serverMarketVersion: Number.isFinite(redisRow?.redisVersion)
        ? redisRow.redisVersion
        : row.serverMarketVersion || null,
      serverUpdatedAt: redisRow?.redisUpdatedAt || row.serverUpdatedAt || null,
      source: hasRedis ? "REDIS_LIVE" : "DB_FALLBACK",
    };
  });
}
