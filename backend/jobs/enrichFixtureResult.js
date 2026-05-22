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
      if (raw == null) return 0;
      const n = Number(String(raw).replace(/%$/, ""));
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

function normalizeApiStats(statsResponse, apiHomeTeamId, apiAwayTeamId) {
  const home = { yellow: 0, red: 0, corners: 0, shotsOnTarget: 0 };
  const away = { yellow: 0, red: 0, corners: 0, shotsOnTarget: 0 };
  for (const entry of statsResponse || []) {
    const teamId = Number(entry?.team?.id);
    const target =
      teamId === apiHomeTeamId ? home : teamId === apiAwayTeamId ? away : null;
    if (!target) continue;
    target.yellow = extractStatValue(entry, /yellow\s*card/i);
    target.red = extractStatValue(entry, /red\s*card/i);
    target.corners = extractStatValue(entry, /corner/i);
    target.shotsOnTarget = extractStatValue(entry, /shots\s*on\s*goal/i);
  }
  return {
    cards: {
      home: { yellow: home.yellow, red: home.red },
      away: { yellow: away.yellow, red: away.red },
    },
    corners: { home: home.corners, away: away.corners },
    shotsOnTarget: { home: home.shotsOnTarget, away: away.shotsOnTarget },
  };
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
