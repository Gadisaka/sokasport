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

function firstNonEmpty(values, fields) {
  if (Array.isArray(values)) {
    for (let i = 0; i < fields.length; i += 1) {
      const raw = values[i];
      if (raw !== null && raw !== undefined && raw !== "") {
        return { value: raw, field: fields[i] };
      }
    }
  }
  return { value: null, field: null };
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

  // One HMGET per key (instead of one HGET per candidate field) and all
  // selections flushed in a single pipeline round-trip (instead of dozens of
  // sequential awaits) — then resolve the matched field in memory.
  const rows = selections.map((sel) => {
    const fields = buildLiveFieldCandidates(sel);
    return {
      sel,
      // hmget needs at least one field; "__none__" never exists in the hash.
      fields: fields.length ? fields : ["__none__"],
      fieldCandidates: fields,
      oddsKey: `live-odds:${sel.apiFixtureId}`,
      stateKey: `live-market-state:${sel.apiFixtureId}`,
      versionKey: `live-market-version:${sel.apiFixtureId}`,
      updatedAtKey: `live-market-updated-at:${sel.apiFixtureId}`,
      lockUntilKey: `live-market-lock-until:${sel.apiFixtureId}`,
    };
  });

  // Round 1: discover which field carries odds for each selection.
  let oddsExec = [];
  try {
    if (rows.length) {
      const p1 = redis.pipeline();
      for (const row of rows) p1.hmget(row.oddsKey, ...row.fields);
      oddsExec = (await p1.exec()) || [];
    }
  } catch {
    oddsExec = [];
  }

  const staged = rows.map((row, i) => {
    const values = Array.isArray(oddsExec[i]) ? oddsExec[i][1] : null;
    const matched = firstNonEmpty(values, row.fields);
    const lookupFields = matched.field ? [matched.field] : row.fields;
    return { ...row, oddsValue: matched.value, lookupFields };
  });

  // Round 2: read state/version/updatedAt/lockUntil for the matched field.
  let metaExec = [];
  try {
    if (staged.length) {
      const p2 = redis.pipeline();
      for (const row of staged) {
        p2.hmget(row.stateKey, ...row.lookupFields);
        p2.hmget(row.versionKey, ...row.lookupFields);
        p2.hmget(row.updatedAtKey, ...row.lookupFields);
        p2.hmget(row.lockUntilKey, ...row.lookupFields);
      }
      metaExec = (await p2.exec()) || [];
    }
  } catch {
    metaExec = [];
  }

  const liveRows = staged.map((row, i) => {
    const base = i * 4;
    const stateVals = Array.isArray(metaExec[base]) ? metaExec[base][1] : null;
    const versionVals = Array.isArray(metaExec[base + 1])
      ? metaExec[base + 1][1]
      : null;
    const updatedVals = Array.isArray(metaExec[base + 2])
      ? metaExec[base + 2][1]
      : null;
    const lockVals = Array.isArray(metaExec[base + 3])
      ? metaExec[base + 3][1]
      : null;
    const state = firstNonEmpty(stateVals, row.lookupFields);
    const version = firstNonEmpty(versionVals, row.lookupFields);
    const updatedAt = firstNonEmpty(updatedVals, row.lookupFields);
    const lockUntil = firstNonEmpty(lockVals, row.lookupFields);
    const lockUntilNum = safeNumber(lockUntil.value);
    return {
      index: row.sel.index,
      apiFixtureId: row.sel.apiFixtureId,
      fieldCandidates: row.fieldCandidates,
      redisOdds: safeNumber(row.oddsValue),
      redisState:
        String(state.value || "")
          .trim()
          .toUpperCase() || null,
      redisVersion: safeNumber(version.value),
      redisUpdatedAt: updatedAt.value || null,
      lockRemainingMs: Number.isFinite(lockUntilNum)
        ? Math.max(0, lockUntilNum - Date.now())
        : 0,
      source: undefined,
    };
  });

  // API-Sports fetch fallback: for any selection that missed Redis, fetch the
  // single-fixture live odds, persist to Redis, and extract the matched odd.
  // Fetches run in parallel (one per missed fixture), so this adds at most one
  // upstream round-trip regardless of leg count.
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

  if (missedFixtureIds.size > 0) {
    const apiFetchedOdds = new Map();
    const fetchPromises = [...missedFixtureIds].map(async (fixtureId) => {
      try {
        const apiResponse =
          await api("football").getSingleFixtureLiveOdds(fixtureId);
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
  }

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
