/**
 * Enrich a terminal fixture with events + statistics from API-Sports,
 * persist them onto the `Fixture` row, and return the refreshed fixture.
 *
 * The normalized payloads are stored as `events_payload` and
 * `stats_payload` JSON blobs, which the V2 `MatchResultV2` builder
 * consumes directly in `services/matchResult/v2.js`.
 *
 * Enrichment is opt-in via `ENABLE_FIXTURE_ENRICHMENT=1`. When
 * disabled the caller gets the unmodified fixture back and settlement
 * proceeds with score-only data (sufficient for the basic markets).
 *
 * @module jobs/enrichFixtureResult
 */
import prisma from "../Config/db.js";
import { api } from "../services/apiSportsService.js";

function periodFromElapsed(elapsed) {
  const n = Number(elapsed);
  if (!Number.isFinite(n)) return "2H";
  if (n <= 45) return "1H";
  if (n <= 90) return "2H";
  if (n <= 105) return "1ET";
  if (n <= 120) return "2ET";
  return "PEN";
}

function normalizeApiEvent(raw, apiHomeTeamId, apiAwayTeamId) {
  const type = String(raw?.type || "").toLowerCase();
  const detail = String(raw?.detail || "").toLowerCase();
  const elapsedMin = Number(raw?.time?.elapsed) || 0;
  const extra = Number(raw?.time?.extra) || 0;
  const minute = elapsedMin + extra;
  const teamId = Number(raw?.team?.id);
  const team =
    teamId === apiHomeTeamId
      ? "HOME"
      : teamId === apiAwayTeamId
        ? "AWAY"
        : null;

  if (type === "goal") {
    return {
      type: "GOAL",
      minute,
      period: periodFromElapsed(elapsedMin),
      team,
      scorer: {
        id: raw?.player?.id != null ? String(raw.player.id) : null,
        name: raw?.player?.name || null,
      },
      assist: raw?.assist?.id
        ? {
            id: String(raw.assist.id),
            name: raw.assist.name || null,
          }
        : null,
      flags: {
        ownGoal: detail.includes("own"),
        penalty: detail.includes("penalty"),
        varOverturned: /var/i.test(String(raw?.comments || "")) &&
          /cancel|overturn/i.test(String(raw?.comments || "")),
      },
    };
  }
  if (type === "card") {
    const color = detail.includes("red")
      ? detail.includes("yellow")
        ? "SECOND_YELLOW"
        : "RED"
      : "YELLOW";
    return {
      type: "CARD",
      minute,
      period: periodFromElapsed(elapsedMin),
      team,
      color,
      player: {
        id: raw?.player?.id != null ? String(raw.player.id) : null,
        name: raw?.player?.name || null,
      },
    };
  }
  return null;
}

function extractStatValue(entry, keyRegex) {
  for (const stat of entry?.statistics || []) {
    if (keyRegex.test(String(stat?.type || ""))) {
      const raw = stat?.value;
      // FAIL-CLOSED: a null/absent provider value means "this league did not
      // report this stat" — return null, NOT 0. Coercing to 0 fabricates a real
      // statistic and would mis-settle (e.g. "Over 9.5 corners" → LOST against a
      // fake 0). A genuine 0 comes through as value:0 and is preserved.
      if (raw == null) return null;
      const n = Number(String(raw).replace(/%$/, ""));
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function normalizeApiStats(statsResponse, apiHomeTeamId, apiAwayTeamId) {
  // FAIL-CLOSED: a non-array / empty response means the provider returned NO
  // statistics (quota wall, rate-limit, API error → the client swallows all of
  // these into `[]`, or genuinely no stats yet). We must NOT fabricate an
  // all-zeros object — that is indistinguishable from a real 0-corner match and
  // would mis-settle "Over N corners" as LOST. Return null so the data-presence
  // gate (stats_payload === null → canEvaluate false → VOID/PENDING) holds.
  if (!Array.isArray(statsResponse) || statsResponse.length === 0) {
    return null;
  }
  const blank = () => ({
    yellow: null, red: null, corners: null, shotsOnTarget: null,
    offsides: null, fouls: null, saves: null, totalShots: null,
  });
  const home = blank();
  const away = blank();
  let matchedTeam = false;
  for (const entry of statsResponse) {
    const teamId = Number(entry?.team?.id);
    const target =
      teamId === apiHomeTeamId ? home : teamId === apiAwayTeamId ? away : null;
    if (!target) continue;
    matchedTeam = true;
    target.yellow = extractStatValue(entry, /yellow\s*card/i);
    target.red = extractStatValue(entry, /red\s*card/i);
    target.corners = extractStatValue(entry, /corner/i);
    target.shotsOnTarget = extractStatValue(entry, /shots\s*on\s*goal/i);
    target.offsides = extractStatValue(entry, /offside/i);
    target.fouls = extractStatValue(entry, /foul/i);
    target.saves = extractStatValue(entry, /goalkeeper\s*saves|^saves$/i);
    target.totalShots = extractStatValue(entry, /total\s*shots/i);
  }
  // Response present but neither team matched (id mismatch / malformed) → treat
  // as absent rather than as a real 0-0 stat line.
  if (!matchedTeam) return null;

  // Per-GROUP presence: a stat group is kept ONLY when both teams reported it
  // (non-null). A null value = "league didn't report this stat" → the group is
  // null → the data-presence gate VOIDs that market instead of grading it
  // against fabricated zeros. A genuine 0 (value:0) is preserved and grades.
  const both = (h, a) => h != null && a != null;
  const cards =
    both(home.yellow, away.yellow) && both(home.red, away.red)
      ? {
          home: { yellow: home.yellow, red: home.red },
          away: { yellow: away.yellow, red: away.red },
        }
      : null;
  // Simple per-team integer stat group → present only when both teams reported.
  const pair = (k) =>
    both(home[k], away[k]) ? { home: home[k], away: away[k] } : null;
  const corners = pair("corners");
  const shotsOnTarget = pair("shotsOnTarget");
  const offsides = pair("offsides");
  const fouls = pair("fouls");
  const saves = pair("saves");
  const totalShots = pair("totalShots");

  // No usable stat group at all → treat the whole response as absent so
  // enrichment does not mark the fixture "stats-enriched" on an empty feed.
  const out = { cards, corners, shotsOnTarget, offsides, fouls, saves, totalShots };
  if (Object.values(out).every((g) => g == null)) return null;
  return out;
}

function enrichmentEnabled() {
  return String(process.env.ENABLE_FIXTURE_ENRICHMENT || "").trim() === "1";
}

/**
 * Fetch and persist events + stats for the given Fixture row. No-op when
 * `ENABLE_FIXTURE_ENRICHMENT !== "1"`, when the fixture is not terminal,
 * or when it has already been enriched (result_hash non-null).
 *
 * @param {string} fixtureId  Prisma Fixture id
 * @param {{ force?: boolean, sport?: string }} [options]
 * @returns {Promise<{ enriched: boolean, reason?: string }>}
 */
export async function enrichFixtureResult(fixtureId, options = {}) {
  if (!enrichmentEnabled() && !options.force) {
    return { enriched: false, reason: "enrichment_disabled" };
  }
  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: {
      home_team: { select: { api_team_id: true } },
      away_team: { select: { api_team_id: true } },
    },
  });
  if (!fixture) return { enriched: false, reason: "not_found" };
  if (fixture.events_payload && fixture.stats_payload && !options.force) {
    return { enriched: false, reason: "already_enriched" };
  }

  const sport = options.sport || "football";
  const client = api(sport);

  let events = [];
  let stats = null;
  try {
    const rawEvents = await client.getFixtureEvents(fixture.api_fixture_id);
    events = (rawEvents || [])
      .map((e) =>
        normalizeApiEvent(
          e,
          Number(fixture.home_team?.api_team_id),
          Number(fixture.away_team?.api_team_id),
        ),
      )
      .filter(Boolean);
  } catch (err) {
    console.warn(
      `[enrichFixtureResult] events fetch failed fixture=${fixtureId}:`,
      err?.message || err,
    );
  }
  try {
    const rawStats = await client.getFixtureStatistics(fixture.api_fixture_id);
    stats = normalizeApiStats(
      rawStats,
      Number(fixture.home_team?.api_team_id),
      Number(fixture.away_team?.api_team_id),
    );
  } catch (err) {
    console.warn(
      `[enrichFixtureResult] stats fetch failed fixture=${fixtureId}:`,
      err?.message || err,
    );
  }

  // FAIL-CLOSED: only mark the fixture "enriched" (bump result_version, the
  // signal matchResult/v2 trusts as "events were really fetched") when the
  // provider actually returned data. If BOTH came back empty — an outage/quota
  // `[]` or stats not finalized yet (~5-15 min post-FT) — write nothing and
  // leave result_version unchanged so settlementRetry re-enriches later. This
  // prevents settling corner/card/goalscorer legs against fabricated emptiness.
  const gotData = events.length > 0 || stats != null;
  if (!gotData) {
    return { enriched: false, reason: "no_data" };
  }

  await prisma.fixture.update({
    where: { id: fixtureId },
    data: {
      events_payload: events.length ? events : null,
      stats_payload: stats || null,
      result_version: (fixture.result_version || 0) + 1,
    },
  });

  return {
    enriched: true,
    events: events.length,
    haveStats: Boolean(stats),
  };
}

// Test-only surface for the fail-closed normalizer (empty/absent ⇒ null).
export const _internals = Object.freeze({ normalizeApiStats });
