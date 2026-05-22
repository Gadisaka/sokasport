/**
 * Env-driven ingestion & public API knobs for fixtures/odds scheduling.
 * When FIXTURES_DAYS_AHEAD is unset, defaults match a 14-day prematch horizon.
 */

function envPositiveInt(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

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
