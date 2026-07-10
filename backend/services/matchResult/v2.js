/**
 * MatchResultV2 — canonical, normalized, immutable match result shape.
 *
 * One producer per data source:
 *   - `buildMatchResultV2FromFixture(fixture, extras?)` — API-sports
 *     fixtures. `extras.events` and `extras.stats` are consumed if
 *     provided; otherwise the builder reads `fixture.events_payload`
 *     and `fixture.stats_payload` if they exist.
 *   - `buildMatchResultV2FromMatch(match)` — admin-managed matches.
 *
 * Every grader in `services/markets/*` consumes this shape and nothing
 * else. Keep this file free of I/O and of `Date.now()`.
 *
 * @module services/matchResult/v2
 */

import { createHash } from "node:crypto";

export const MATCH_RESULT_SCHEMA_VERSION = 2;

const FINAL_STATUSES = new Set(["FT", "AET", "PEN"]);
const AWARDED_STATUSES = new Set(["AWD", "WO"]);
const VOID_STATUSES = new Set(["CANC", "ABD", "PST"]);

/**
 * @param {string|null|undefined} status
 * @returns {"PENDING"|"FINAL"|"AWARDED"|"VOID"}
 */
export function deriveFinality(status) {
  const s = String(status || "").toUpperCase().trim();
  if (FINAL_STATUSES.has(s)) return "FINAL";
  if (AWARDED_STATUSES.has(s)) return "AWARDED";
  if (VOID_STATUSES.has(s)) return "VOID";
  return "PENDING";
}

function toIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function toNonNegInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function normalizeGoalEvent(raw, idx) {
  const minute = Number(raw?.minute);
  const team = String(raw?.team || "").toUpperCase();
  return {
    id: raw?.id != null ? String(raw.id) : `g-${idx}`,
    type: "GOAL",
    minute: Number.isFinite(minute) ? Math.max(0, Math.trunc(minute)) : 0,
    period: String(raw?.period || "").toUpperCase() || "2H",
    team: team === "HOME" || team === "AWAY" ? team : null,
    scorer: {
      id: raw?.scorer?.id != null ? String(raw.scorer.id) : null,
      name: raw?.scorer?.name ? String(raw.scorer.name) : null,
    },
    assist: raw?.assist
      ? {
          id: raw.assist.id != null ? String(raw.assist.id) : null,
          name: raw.assist.name ? String(raw.assist.name) : null,
        }
      : null,
    flags: {
      ownGoal: Boolean(raw?.flags?.ownGoal),
      penalty: Boolean(raw?.flags?.penalty),
      varOverturned: Boolean(raw?.flags?.varOverturned),
    },
  };
}

function normalizeCardEvent(raw, idx) {
  const minute = Number(raw?.minute);
  const color = String(raw?.color || "").toUpperCase();
  const team = String(raw?.team || "").toUpperCase();
  return {
    id: raw?.id != null ? String(raw.id) : `c-${idx}`,
    type: "CARD",
    minute: Number.isFinite(minute) ? Math.max(0, Math.trunc(minute)) : 0,
    color: ["YELLOW", "RED", "SECOND_YELLOW"].includes(color) ? color : "YELLOW",
    team: team === "HOME" || team === "AWAY" ? team : null,
    player: {
      id: raw?.player?.id != null ? String(raw.player.id) : null,
      name: raw?.player?.name ? String(raw.player.name) : null,
    },
  };
}

function normalizeEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) return [];
  const out = [];
  for (let i = 0; i < rawEvents.length; i++) {
    const e = rawEvents[i];
    const type = String(e?.type || "").toUpperCase();
    if (type === "GOAL") out.push(normalizeGoalEvent(e, i));
    else if (type === "CARD") out.push(normalizeCardEvent(e, i));
  }
  out.sort((a, b) => {
    if (a.minute !== b.minute) return a.minute - b.minute;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

function normalizeStats(rawStats) {
  // Presence-aware: a missing stats payload means the fixture was NOT stat-
  // enriched, so each stat group is left `undefined` and its market's
  // canEvaluate() returns false → VOID/missing_required_data, NOT a grade
  // against a fabricated 0. A PRESENT group with 0 corners/cards is a valid
  // graded state (enriched-zero) and is kept. Mirrors the `shotsOnTarget`
  // idiom that already worked this way.
  const s = rawStats && typeof rawStats === "object" ? rawStats : null;
  // Simple per-team integer group → present object or undefined (presence-aware).
  const pair = (g) =>
    g && g.home != null && g.away != null
      ? { home: toNonNegInt(g.home), away: toNonNegInt(g.away) }
      : undefined;
  return {
    cards: s?.cards
      ? {
          home: {
            yellow: toNonNegInt(s.cards.home?.yellow),
            red: toNonNegInt(s.cards.home?.red),
          },
          away: {
            yellow: toNonNegInt(s.cards.away?.yellow),
            red: toNonNegInt(s.cards.away?.red),
          },
        }
      : undefined,
    corners: pair(s?.corners),
    shotsOnTarget: pair(s?.shotsOnTarget),
    offsides: pair(s?.offsides),
    fouls: pair(s?.fouls),
    saves: pair(s?.saves),
    totalShots: pair(s?.totalShots),
  };
}

function canonicalStringify(value) {
  // Deterministic JSON: keys sorted alphabetically, no whitespace.
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    if (value[k] === undefined) continue;
    parts.push(JSON.stringify(k) + ":" + canonicalStringify(value[k]));
  }
  return "{" + parts.join(",") + "}";
}

function hashPayload(payload) {
  const canonical = canonicalStringify(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * FINAL fixtures must be internally consistent: the number of
 * non-VAR-overturned goal events must equal `home_score + away_score`,
 * and each team's goals must match its score. If they don't, we
 * downgrade to PENDING so the engine returns `PENDING` and a retry job
 * can pick this up once upstream data is repaired. We never throw —
 * settlement must be resilient to dirty feeds.
 */
function detectInconsistency(payload) {
  if (payload.finality !== "FINAL") return null;
  const { home, away } = payload.scores.fullTime;
  if (!Number.isInteger(home) || !Number.isInteger(away)) {
    return "final_without_scores";
  }
  if (!Array.isArray(payload.events)) return null;
  // Count only goals that contribute to the 90' regulation score. Exclude:
  //  - VAR-overturned goals (chalked off),
  //  - penalty-SHOOTOUT goals (post-ET tie-breaker; NOT part of `score.fulltime`
  //    — a 1-1 game won 4-3 on pens still has a 1-1 score). Counting shootout
  //    goals would always mismatch the score and strand every PEN fixture, and
  //  - EXTRA-TIME goals (`1ET`/`2ET`). `scores.fullTime` now holds the 90'
  //    regulation score (Match Winner et al. settle on regulation), so an ET
  //    goal is not part of that tally — counting it would mismatch and strand
  //    every AET fixture.
  const liveGoals = payload.events.filter(
    (e) =>
      e.type === "GOAL" &&
      !e.flags?.varOverturned &&
      !e.flags?.shootout &&
      e.period !== "PEN" &&
      e.period !== "1ET" &&
      e.period !== "2ET",
  );
  if (liveGoals.length === 0) return null; // no usable events — trust scores
  // Count by CREDITED team: an own goal's event carries the scoring player's
  // team, but the goal counts for the opponent (which is how the score is
  // tallied). Counting raw event.team here would falsely flag every own-goal
  // match as inconsistent and downgrade ALL its markets to PENDING.
  const credited = (e) =>
    e.flags?.ownGoal
      ? e.team === "HOME"
        ? "AWAY"
        : e.team === "AWAY"
          ? "HOME"
          : null
      : e.team;
  const homeGoals = liveGoals.filter((e) => credited(e) === "HOME").length;
  const awayGoals = liveGoals.filter((e) => credited(e) === "AWAY").length;
  if (homeGoals !== home || awayGoals !== away) {
    return `score_event_mismatch:${homeGoals}-${awayGoals}_vs_${home}-${away}`;
  }
  return null;
}

function logInconsistency(source, id, reason, action) {
  // Structured, single-line; scraped by ops dashboards. `action` states what
  // we actually did: PENDING downgrade (no score) vs events-distrusted (score
  // kept, score-only markets still settle).
  console.warn(
    `[matchResult/v2] inconsistent_payload source=${source} id=${id} reason=${reason} — ${action}`,
  );
}

/**
 * Build a canonical MatchResultV2 from an API-sports fixture row.
 *
 * @param {object} fixture - Prisma Fixture row (may carry
 *   `ht_home_score`, `ht_away_score`, `events_payload`,
 *   `stats_payload`, `result_version`).
 * @param {{ events?: Array, stats?: object, resultVersionOverride?: number }} [extras]
 * @returns {MatchResultV2}
 */
export function buildMatchResultV2FromFixture(fixture, extras = {}) {
  if (!fixture) {
    // Never throw — settlement callers rely on a stable shape.
    return pendingPlaceholder({ source: "FIXTURE" });
  }

  const status = String(fixture.status || "").toUpperCase();
  let finality = deriveFinality(status);

  const scores = {
    fullTime: {
      home: toIntOrNull(fixture.home_score),
      away: toIntOrNull(fixture.away_score),
    },
    halfTime: {
      home: toIntOrNull(fixture.ht_home_score),
      away: toIntOrNull(fixture.ht_away_score),
    },
  };
  if (fixture.et_home_score != null || fixture.et_away_score != null) {
    scores.extraTime = {
      home: toIntOrNull(fixture.et_home_score),
      away: toIntOrNull(fixture.et_away_score),
    };
  }
  if (fixture.pen_home_score != null || fixture.pen_away_score != null) {
    scores.penalties = {
      home: toIntOrNull(fixture.pen_home_score),
      away: toIntOrNull(fixture.pen_away_score),
    };
  }

  const resultVersion =
    Number.isFinite(Number(extras.resultVersionOverride))
      ? Number(extras.resultVersionOverride)
      : Number.isFinite(Number(fixture.result_version))
        ? Number(fixture.result_version)
        : 0;

  // Events presence gate. `events_payload === null` is ambiguous: it can mean
  // "not enriched" OR "enriched, genuinely no goal/card events" (the enrichment
  // job stores null for empty events). `result_version > 0` means the fixture
  // WAS enriched, so a null payload then = a real empty set ([]). When NOT
  // enriched and no explicit events array, leave `events = null` so event
  // markets (goalscorer / player cards) VOID instead of grading against [].
  const rawEvents = extras.events ?? fixture.events_payload;
  const wasEnriched = resultVersion > 0;
  const events =
    Array.isArray(rawEvents) || wasEnriched ? normalizeEvents(rawEvents) : null;
  const stats = normalizeStats(extras.stats ?? fixture.stats_payload);

  const payload = {
    schemaVersion: MATCH_RESULT_SCHEMA_VERSION,
    source: "FIXTURE",
    fixtureId: fixture.id ?? null,
    apiFixtureId: Number.isFinite(Number(fixture.api_fixture_id))
      ? Number(fixture.api_fixture_id)
      : null,
    status,
    finality,
    finalizedAt: fixture.settled_at instanceof Date
      ? fixture.settled_at.toISOString()
      : fixture.settled_at || null,
    scores,
    stats,
    events,
    resultLabel: null,
    provider: "API_SPORTS",
    resultVersion,
  };

  const inconsistency = detectInconsistency(payload);
  if (inconsistency === "final_without_scores") {
    // No usable final score on a terminal fixture — nothing can be graded yet.
    // Downgrade to PENDING so a retry settles it once the score lands.
    payload.finality = "PENDING";
    logInconsistency(
      "FIXTURE",
      fixture.id ?? fixture.api_fixture_id,
      inconsistency,
      "downgraded finality to PENDING (no usable score)",
    );
  } else if (inconsistency) {
    // Score is present and trusted, but the goal EVENTS don't reconcile to it
    // (sparse/incomplete feed, own-goal mis-attribution, late VAR edit). On a
    // terminal fixture the SCORE is authoritative, so we keep finality FINAL —
    // score-derived markets (match winner, double chance, O/U, BTTS, handicaps,
    // totals) settle normally. We distrust only the events: null them so
    // event-derived markets (goalscorer, correct-score-by-events) fail
    // canEvaluate() and VOID/refund instead of grading against a broken feed.
    payload.events = null;
    logInconsistency(
      "FIXTURE",
      fixture.id ?? fixture.api_fixture_id,
      inconsistency,
      "events distrusted (nulled); score kept, finality stays FINAL",
    );
  }

  payload.hash = hashPayload(payload);
  return Object.freeze(payload);
}

/**
 * Build a canonical MatchResultV2 from an admin-managed Match row.
 *
 * @param {object} match - Prisma Match row
 * @returns {MatchResultV2}
 */
export function buildMatchResultV2FromMatch(match) {
  if (!match) return pendingPlaceholder({ source: "MATCH" });
  const status = String(match.status || "").toUpperCase();
  // Admin matches model finality via MatchStatus (NOT_STARTED / LIVE /
  // SUSPENDED / FINISHED). Only FINISHED is terminal.
  const finality = status === "FINISHED" ? "FINAL" : "PENDING";

  const payload = {
    schemaVersion: MATCH_RESULT_SCHEMA_VERSION,
    source: "MATCH",
    matchId: match.id ?? null,
    status,
    finality,
    finalizedAt: match.settled_at instanceof Date
      ? match.settled_at.toISOString()
      : match.settled_at || null,
    scores: {
      fullTime: { home: null, away: null },
      halfTime: {
        home: toIntOrNull(match.ht_home_score),
        away: toIntOrNull(match.ht_away_score),
      },
    },
    stats: normalizeStats(null),
    events: normalizeEvents(match.events_payload),
    resultLabel: match.result ? String(match.result) : null,
    provider: "ADMIN",
    resultVersion: 0,
  };
  payload.hash = hashPayload(payload);
  return Object.freeze(payload);
}

function pendingPlaceholder(base) {
  const payload = {
    schemaVersion: MATCH_RESULT_SCHEMA_VERSION,
    source: base.source,
    status: "",
    finality: "PENDING",
    finalizedAt: null,
    scores: {
      fullTime: { home: null, away: null },
      halfTime: { home: null, away: null },
    },
    stats: normalizeStats(null),
    events: [],
    resultLabel: null,
    provider: base.source === "FIXTURE" ? "API_SPORTS" : "ADMIN",
    resultVersion: 0,
  };
  payload.hash = hashPayload(payload);
  return Object.freeze(payload);
}

// Re-exports convenient for tests / shadow mode:
export const _internals = Object.freeze({
  canonicalStringify,
  hashPayload,
  normalizeEvents,
  normalizeStats,
  detectInconsistency,
});
