/**
 * Env-driven ingestion & public API knobs for fixtures/odds scheduling.
 * When FIXTURES_DAYS_AHEAD is unset, defaults match a 14-day prematch horizon.
 */

function envPositiveInt(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
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

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Maximum fixture ingest horizon (UTC calendar days starting today). */
export function getFixturesDaysAhead() {
  return envPositiveInt("FIXTURES_DAYS_AHEAD", 14);
}

/**
 * Lookback window for catching yesterday's fixtures whose status was missed.
 * Default 2 days behind (yesterday + day before).
 */
export function getFixturesDaysBehind() {
  return envPositiveInt("FIXTURES_DAYS_BEHIND", 2);
}

/** Hours between lookback sync ticks. Default 4 hours. */
export function getLookbackIntervalHours() {
  const v = Number(process.env.FIXTURES_LOOKBACK_INTERVAL_HOURS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 4;
}

/**
 * High-frequency fixture job spans offsets [0 .. window-1].
 * Default min(3, FIXTURES_DAYS_AHEAD). Set to 1 to restore legacy "today-only" slice volume.
 */
export function getNearFixtureWindowDays() {
  const max = getFixturesDaysAhead();
  const explicit = Number(process.env.FIXTURES_NEAR_WINDOW_DAYS);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(Math.floor(explicit), max);
  }
  return Math.min(3, max);
}

/** Hours between near-window fixture sync ticks; falls back to FIXTURES_TODAY_HOURS. */
export function getNearFixtureIntervalHours() {
  const primary = Number(process.env.FIXTURES_NEAR_INTERVAL_HOURS);
  if (Number.isFinite(primary) && primary > 0) return Math.floor(primary);
  const legacy = Number(process.env.FIXTURES_TODAY_HOURS);
  if (Number.isFinite(legacy) && legacy > 0) return Math.floor(legacy);
  return 2;
}

/** Hours between full-horizon fixture sync ticks; falls back to FIXTURES_FUTURE_HOURS. */
export function getDeepFixtureIntervalHours() {
  const primary = Number(process.env.FIXTURES_DEEP_INTERVAL_HOURS);
  if (Number.isFinite(primary) && primary > 0) return Math.floor(primary);
  const legacy = Number(process.env.FIXTURES_FUTURE_HOURS);
  if (Number.isFinite(legacy) && legacy > 0) return Math.floor(legacy);
  return 6;
}

/** Odds ingest/query horizon in UTC days; defaults to fixture horizon when unset. */
export function getOddsHorizonDays() {
  const od = Number(process.env.ODDS_HORIZON_DAYS);
  if (Number.isFinite(od) && od > 0) return Math.floor(od);
  return getFixturesDaysAhead();
}

/**
 * When set, odds sync prefers fixtures whose kickoff falls within this many UTC calendar days from today (within odds horizon).
 * Returns null when unset (no extra prioritization).
 */
export function getOddsNearPriorityDays() {
  const n = Number(process.env.ODDS_NEAR_PRIORITY_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * UTC end instant for "near priority" ordering (end of day today + (days - 1) offsets).
 */
export function getOddsNearPriorityEndUtc(nearDays) {
  const safe = Math.max(1, Number(nearDays) || 1);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + safe - 1);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/**
 * Adaptive delay before the next odds recheck for a fixture, based on
 * kickoff distance. Far-out unpriced fixtures must not be re-asked every
 * few minutes — that wastes the daily API budget and selection slots.
 *
 * @param {Date|string|number|null|undefined} startTime
 * @param {Date|number} [now]
 * @returns {number} delay in milliseconds
 */
export function nextOddsRecheckDelayMs(startTime, now = Date.now()) {
  const kickoffMs = new Date(startTime).getTime();
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(kickoffMs) || !Number.isFinite(nowMs)) {
    return 4 * HOUR_MS;
  }
  const msUntil = kickoffMs - nowMs;
  if (msUntil <= 24 * HOUR_MS) return 15 * MINUTE_MS;
  if (msUntil <= 3 * 24 * HOUR_MS) return 1 * HOUR_MS;
  if (msUntil <= 7 * 24 * HOUR_MS) return 4 * HOUR_MS;
  return 12 * HOUR_MS;
}

/** @returns {Date} */
export function computeNextOddsCheckAt(startTime, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return new Date(nowMs + nextOddsRecheckDelayMs(startTime, nowMs));
}

/**
 * Daily upstream call budget for prematch odds jobs (tick + bulk + backfill).
 * Default 70000 leaves headroom under a 150k API-Sports daily limit for
 * live scores / fixtures. Set to 0 to disable enforcement.
 */
export function getOddsDailyCallBudget() {
  const raw = process.env.ODDS_DAILY_CALL_BUDGET;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return 70000;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 70000;
  return Math.floor(n);
}

/**
 * Bulk `/odds?date=` sweep across the full horizon.
 * ODDS_BULK_BY_DATE_ENABLED=false to disable the scheduled job.
 */
export function isOddsBulkByDateEnabled() {
  return envBool("ODDS_BULK_BY_DATE_ENABLED", true);
}

/** Hours between bulk odds-by-date sweeps (matches upstream ~3h refresh). */
export function getOddsBulkIntervalHours() {
  return envPositiveInt("ODDS_BULK_INTERVAL_HOURS", 3);
}

/** Cap pages walked per date on `/odds?date=` (10 fixtures/page upstream). */
export function getOddsBulkMaxPagesPerDate() {
  return envPositiveInt("ODDS_BULK_MAX_PAGES_PER_DATE", 100);
}

/** Delay between bulk odds pages to avoid rate-limit bursts. */
export function getOddsBulkPageDelayMs() {
  return envPositiveInt("ODDS_BULK_PAGE_DELAY_MS", 400);
}

/**
 * Used when admin preferred bookmaker is set but BOOKMAKER_FALLBACK_CHAIN is empty.
 * Lower-tier leagues (e.g. Ethiopia Premier League) often lack Bet365 lines but
 * are covered by these books.
 */
export const DEFAULT_BOOKMAKER_FALLBACK_CHAIN = [
  2, // Marathonbet
  11, // 1xBet
  16, // Unibet
  34, // Superbet
  32, // Betano
  3, // Betfair
];

/** Comma-separated API-Sports bookmaker ids (preference tail after admin preferred). */
export function parseBookmakerFallbackChain() {
  const raw = process.env.BOOKMAKER_FALLBACK_CHAIN;
  if (!raw?.trim()) return [];
  const out = [];
  for (const part of raw.split(",")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

let leagueTierMapWarned = false;

/** api_league_id -> tier (0 = elite). Empty map when JSON invalid / unset. */
export function getLeagueTierMap() {
  const raw = process.env.LEAGUE_TIERS_JSON;
  if (!raw?.trim()) return new Map();
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return new Map();
    const m = new Map();
    for (const [k, v] of Object.entries(obj)) {
      const leagueId = Number.parseInt(k, 10);
      const tier = Number(v);
      if (Number.isFinite(leagueId) && Number.isFinite(tier)) {
        m.set(leagueId, tier);
      }
    }
    return m;
  } catch {
    if (!leagueTierMapWarned) {
      leagueTierMapWarned = true;
      console.warn(
        "[ingestionConfig] LEAGUE_TIERS_JSON invalid JSON — ignoring tier map",
      );
    }
    return new Map();
  }
}

/**
 * When true, /fixtures/today and /fixtures/upcoming omit fixtures without preferred-bookmaker lines.
 * Default false: fixtures always listed; odds fallback uses other bookmakers when needed.
 */
export function isPublicFixturesStrictBookmaker() {
  const v = process.env.PUBLIC_FIXTURES_STRICT_BOOKMAKER;
  return v === "1" || String(v).toLowerCase() === "true";
}

/** UTC calendar span covered by a fixture bulk job (for odds backfill cap). */
export function syncedUtcDaysSpan({ daysAhead, startOffset, endOffset }) {
  if (Number.isFinite(daysAhead) && daysAhead > 0) {
    return Math.floor(daysAhead);
  }
  if (
    Number.isFinite(startOffset) &&
    Number.isFinite(endOffset) &&
    endOffset >= startOffset
  ) {
    return Math.floor(endOffset - startOffset + 1);
  }
  return getFixturesDaysAhead();
}
