import { getRedisClient } from "../cacheService.js";
import {
  buildMarketNameCandidates,
  buildSelectionCandidates,
  resolvePrematchOdds,
} from "./resolveOdds.js";
import { resolveLiveLegState } from "./marketState.js";
import { readFixtureLockRemainingMs } from "./liveFixtureLock.js";
import { api } from "../apiSportsService.js";
import {
  writeLiveOddsSnapshot,
  LIVE_ODDS_SNAPSHOT_TTL_SECONDS,
} from "../liveOddsCache.js";

const LIVE_ODDS_MAX_AGE_MS = Number(process.env.LIVE_ODDS_MAX_AGE_MS || 15000);
const SNAPSHOT_SKEW_TOLERANCE_MS = Number(
  process.env.LIVE_ODDS_SKEW_TOLERANCE_MS || 3000,
);

if (
  LIVE_ODDS_SNAPSHOT_TTL_SECONDS * 1000 <=
  LIVE_ODDS_MAX_AGE_MS + SNAPSHOT_SKEW_TOLERANCE_MS
) {
  console.warn(
    `[resolveLiveOdds] LIVE_ODDS_SNAPSHOT_TTL_SECONDS=${LIVE_ODDS_SNAPSHOT_TTL_SECONDS}s ` +
      `is not comfortably above the freshness window ` +
      `(${(LIVE_ODDS_MAX_AGE_MS + SNAPSHOT_SKEW_TOLERANCE_MS) / 1000}s) — ` +
      `fresh snapshots may be evicted before they age out.`,
  );
}

export function isSnapshotFresh(
  updatedAtIso,
  nowMs = Date.now(),
  maxAgeMs = LIVE_ODDS_MAX_AGE_MS,
) {
  if (!updatedAtIso) return false;
  const t = Date.parse(updatedAtIso);
  if (!Number.isFinite(t)) return false;
  const age = nowMs - t;
  if (age < 0) return -age <= SNAPSHOT_SKEW_TOLERANCE_MS;
  return age <= maxAgeMs;
}

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

  const rows = selections.map((sel) => {
    const fields = buildLiveFieldCandidates(sel);
    return {
      sel,
      fields: fields.length ? fields : ["__none__"],
      fieldCandidates: fields,
      oddsKey: `live-odds:${sel.apiFixtureId}`,
      stateKey: `live-market-state:${sel.apiFixtureId}`,
      versionKey: `live-market-version:${sel.apiFixtureId}`,
      updatedAtKey: `live-market-updated-at:${sel.apiFixtureId}`,
      lockUntilKey: `live-market-lock-until:${sel.apiFixtureId}`,
    };
  });

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

  const missedFixtureIds = new Set();
  const selectionsByFixture = new Map();
  for (let i = 0; i < liveRows.length; i++) {
    const row = liveRows[i];
    const hasRedis =
      Number.isFinite(row.redisOdds) &&
      row.redisOdds > 1 &&
      isSnapshotFresh(row.redisUpdatedAt);
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

  const fixtureLockMs = await readFixtureLockRemainingMs(
    redis,
    selections.map((sel) => sel.apiFixtureId),
  );

  return fallback.map((row) => {
    const redisRow = redisByIndex.get(row.index);
    const hasLiveOdds =
      Number.isFinite(redisRow?.redisOdds) &&
      redisRow.redisOdds > 1 &&
      isSnapshotFresh(redisRow?.redisUpdatedAt);
    const hasDbFallback =
      Number.isFinite(row.serverOdds) && row.serverOdds > 1;
    const lockRemainingMs = Math.max(
      0,
      Number(redisRow?.lockRemainingMs || 0),
    );
    const apiFixtureId = Number(row.apiFixtureId ?? redisRow?.apiFixtureId);
    const fixtureLockRemainingMs = Math.max(
      0,
      Number(fixtureLockMs.get(apiFixtureId) || 0),
    );

    const { marketState, serverLive } = resolveLiveLegState({
      fixtureStatus: row.fixtureStatus,
      started: row.started,
      hasLiveOdds,
      hasDbFallback,
      redisState: redisRow?.redisState || null,
      lockRemainingMs,
      fixtureLockRemainingMs,
    });

    const serverOdds = serverLive
      ? hasLiveOdds
        ? redisRow.redisOdds
        : NaN
      : hasDbFallback
        ? row.serverOdds
        : hasLiveOdds
          ? redisRow.redisOdds
          : NaN;

    const source = serverLive
      ? hasLiveOdds
        ? redisRow.source || "REDIS_LIVE"
        : "NO_LIVE_SOURCE"
      : hasDbFallback
        ? "DB_FALLBACK"
        : hasLiveOdds
          ? redisRow.source || "REDIS_LIVE"
          : "NO_SOURCE";

    const marketStateReason =
      marketState === "OPEN"
        ? "ok"
        : fixtureLockRemainingMs > 0
          ? "event_locked"
          : marketState === "LOCKED"
            ? "locked"
            : serverLive && !hasLiveOdds
              ? "no_live_source"
              : marketState === "CLOSED"
                ? "ended"
                : "suspended";

    return {
      ...row,
      serverLive,
      serverOdds,
      marketState,
      marketStateReason,
      lockRemainingMs,
      fixtureLockRemainingMs,
      serverMarketVersion: Number.isFinite(redisRow?.redisVersion)
        ? redisRow.redisVersion
        : row.serverMarketVersion || null,
      serverUpdatedAt: redisRow?.redisUpdatedAt || row.serverUpdatedAt || null,
      source,
    };
  });
}
