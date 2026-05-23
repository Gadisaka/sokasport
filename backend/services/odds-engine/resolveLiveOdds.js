import { getRedisClient } from "../cacheService.js";
import {
  buildMarketNameCandidates,
  buildSelectionCandidates,
  resolvePrematchOdds,
} from "./resolveOdds.js";
import { resolveMarketState } from "./marketState.js";
import { api } from "../apiSportsService.js";
import { writeLiveOddsSnapshot } from "../liveOddsCache.js";

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

async function lookupRedisOdds(redis, sel) {
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
    fieldCandidates,
  };
}

function parseApiResponseToSnapshot(apiResponse) {
  if (!apiResponse?.length) return null;
  const entry = apiResponse[0];
  const odds = entry?.odds || [];
  if (!odds.length) return null;

  return {
    bookmakers: [
      {
        markets: odds
          .filter((o) => o.name && Array.isArray(o.values) && o.values.length > 0)
          .map((o) => ({
            name: o.name,
            values: o.values
              .filter((v) => !v.suspended && v.odd)
              .map((v) => ({
                value: v.handicap ? `${v.value} ${v.handicap}` : v.value,
                odd: Number.parseFloat(v.odd),
              })),
          }))
          .filter((m) => m.values.length > 0),
      },
    ],
  };
}

function extractOddFromSnapshot(parsed, fieldCandidates) {
  if (!parsed?.bookmakers?.[0]?.markets) return null;
  const candidateSet = new Set(fieldCandidates);
  for (const market of parsed.bookmakers[0].markets) {
    const marketName = market.name;
    for (const v of market.values || []) {
      const field = `${marketName}|${v.value}`;
      if (candidateSet.has(field)) {
        return { odd: v.odd, field };
      }
    }
  }
  return null;
}

export async function resolveLiveOdds({
  prismaClient,
  selections = [],
  now = new Date(),
}) {
  const redis = getRedisClient();

  // Step 1: Initial Redis lookup for all selections
  const liveRows = await Promise.all(
    selections.map((sel) => lookupRedisOdds(redis, sel)),
  );

  // Step 2: Identify fixtures with Redis miss that need API fetch
  const missedFixtureIds = new Set();
  const selectionsByFixture = new Map();
  for (let i = 0; i < liveRows.length; i++) {
    const row = liveRows[i];
    const hasRedis = Number.isFinite(row.redisOdds) && row.redisOdds > 1;
    if (!hasRedis && Number.isFinite(row.apiFixtureId)) {
      missedFixtureIds.add(row.apiFixtureId);
      if (!selectionsByFixture.has(row.apiFixtureId)) {
        selectionsByFixture.set(row.apiFixtureId, []);
      }
      selectionsByFixture.get(row.apiFixtureId).push({
        rowIndex: i,
        fieldCandidates: row.fieldCandidates,
      });
    }
  }

  // Step 3: Fetch from API-Sports for missed fixtures and write to Redis
  const apiFetchedOdds = new Map();
  if (missedFixtureIds.size > 0) {
    const fetchPromises = [...missedFixtureIds].map(async (fixtureId) => {
      try {
        const apiResponse = await api("football").getSingleFixtureLiveOdds(fixtureId);
        const parsed = parseApiResponseToSnapshot(apiResponse);
        if (parsed && parsed.bookmakers[0].markets.length > 0) {
          await writeLiveOddsSnapshot(fixtureId, parsed);
          apiFetchedOdds.set(fixtureId, parsed);
        }
      } catch (err) {
        console.error(
          `[resolveLiveOdds] API fetch failed for fixture ${fixtureId}:`,
          err.message,
        );
      }
    });
    await Promise.all(fetchPromises);
  }

  // Step 4: Update liveRows with API-fetched odds
  for (const [fixtureId, parsed] of apiFetchedOdds) {
    const sels = selectionsByFixture.get(fixtureId) || [];
    for (const { rowIndex, fieldCandidates } of sels) {
      const extracted = extractOddFromSnapshot(parsed, fieldCandidates);
      if (extracted) {
        liveRows[rowIndex].redisOdds = extracted.odd;
        liveRows[rowIndex].redisUpdatedAt = new Date().toISOString();
        liveRows[rowIndex].source = "API_LIVE_FETCH";
      }
    }
  }

  const redisByIndex = new Map(liveRows.map((row) => [row.index, row]));

  // Step 5: Final prematch DB fallback for anything still missing
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
    const source = hasRedis
      ? redisRow.source || "REDIS_LIVE"
      : "DB_FALLBACK";

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
      source,
    };
  });
}
