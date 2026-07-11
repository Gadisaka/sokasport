import prisma from "../Config/db.js";
import { upsertNoTx } from "../utils/upsertNoTx.js";
import { api, sleep } from "../services/apiSportsService.js";
import { deleteByPattern } from "../services/cacheService.js";
import { refreshFixturesByDateCaches } from "../services/fixturesListService.js";
import { getEnabledSports } from "../services/sportsRegistry.js";
import { PRODUCT_PRIORITY_LEAGUE_IDS } from "../Config/allowedLeagues.js";
import {
  getIngestActiveCap,
  pickTopActiveLeagues,
} from "../Config/leagueRanks.js";
import { getFixturesDaysAhead } from "../Config/ingestionConfig.js";
import {
  isTerminalFixtureStatus,
  settleFixture,
} from "../services/ticketSettlementService.js";
import { enrichFixtureResult } from "./enrichFixtureResult.js";
import {
  buildFixtureSyncData,
  fixtureSyncUnchanged,
} from "../lib/fixtureResultLock.js";
import { resolveFixtureScores } from "./lib/fixtureScores.js";

/**
 * Bulk-by-date fixture ingestion.
 *
 * One upstream call per calendar date returns every fixture (across all
 * leagues) for that day. API volume scales roughly **dates × enabled sports**
 * per run (plus FIXTURES_DATE_DELAY_MS pacing between dates).
 *
 * Concurrency: serialized by the BullMQ queue (concurrency=1). The legacy
 * Redis-based in-process lock has been removed; the queue is the lock now.
 */

// Exported for the settlement retry job's zombie-rescue path, which maps
// single-fixture API responses with the exact same rules as the bulk sync.
export const STATUS_MAP = {
  TBD: "NS",
  NS: "NS",
  "1H": "LIVE",
  HT: "HT",
  "2H": "LIVE",
  ET: "LIVE",
  BT: "LIVE",
  P: "PEN",
  FT: "FT",
  AET: "AET",
  PEN: "PEN",
  PST: "PST",
  CANC: "CANC",
  ABD: "ABD",
  AWD: "AWD",
  WO: "WO",
  LIVE: "LIVE",
  SUSP: "SUSP",
  INT: "LIVE",
  FINISHED: "FT",
  ENDED: "FT",
  CLOSED: "FT",
};

const DATE_CALL_DELAY_MS = Number(process.env.FIXTURES_DATE_DELAY_MS || 1500);

function todayPlusDays(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().split("T")[0];
}

/**
 * Inclusive UTC calendar dates from day offsets (0 = today UTC).
 * Negative offsets are allowed for lookback syncs (e.g. -2 = 2 days ago).
 */
export function offsetsToDates(startOffset, endOffsetInclusive) {
  const start = Math.floor(Number(startOffset) || 0);
  const end = Math.max(start, Math.floor(Number(endOffsetInclusive) || start));
  const dates = [];
  for (let i = start; i <= end; i++) {
    dates.push(todayPlusDays(i));
  }
  return dates;
}

/**
 * Cache the "football" sport row across a single run so we don't re-query
 * Mongo for every fixture entry.
 */
async function getOrUpsertSport(sportSlug, providerName, sportCache) {
  if (sportCache.has(sportSlug)) return sportCache.get(sportSlug);

  const sport = await upsertNoTx(prisma.sport, {
    where: { slug: sportSlug },
    update: {},
    create: { name: providerName ?? sportSlug, slug: sportSlug },
  });
  sportCache.set(sportSlug, sport);
  return sport;
}

/**
 * Upsert a league pulled from the bulk fixtures response. The response
 * carries the season the API-Sports treats as "current" for that league
 * on that date, which is the freshest value we can get without a second
 * `/leagues` call.
 */
async function upsertLeagueFromEntry(entry, sportId, leagueCache) {
  const lg = entry.league;
  if (!lg?.id) return null;

  const cached = leagueCache.get(lg.id);
  if (cached) return cached;

  const league = await upsertNoTx(prisma.league, {
    where: { api_league_id: lg.id },
    update: {
      name: lg.name ?? "Unknown",
      country: lg.country ?? null,
      country_flag: lg.flag ?? null,
      logo: lg.logo ?? null,
      season: lg.season ?? null,
    },
    create: {
      api_league_id: lg.id,
      name: lg.name ?? "Unknown",
      country: lg.country ?? null,
      country_flag: lg.flag ?? null,
      logo: lg.logo ?? null,
      season: lg.season ?? null,
      sport_id: sportId,
      active: true,
    },
  });
  leagueCache.set(lg.id, league);
  return league;
}

/**
 * Upsert a team. The Team model carries a single `league_id`, which is
 * tricky for sides that play across cups + domestic leagues. We keep the
 * first league we see for a team and only create-with-league; subsequent
 * upserts only refresh name/logo so the league association doesn't churn.
 */
async function upsertTeamFromEntry(teamApi, leagueId, teamCache) {
  if (!teamApi?.id) return null;
  const cached = teamCache.get(teamApi.id);
  if (cached) return cached;

  const existing = await prisma.team.findUnique({
    where: { api_team_id: teamApi.id },
  });

  let team;
  if (existing) {
    // Skip write when the upstream payload didn't change anything we persist.
    // Most fixture syncs re-emit identical team rows, so this avoids a large
    // share of redundant Mongo updates without changing observable state.
    const newName = teamApi.name ?? existing.name;
    const newLogo = teamApi.logo ?? existing.logo ?? null;
    if (existing.name === newName && existing.logo === newLogo) {
      team = existing;
    } else {
      team = await prisma.team.update({
        where: { api_team_id: teamApi.id },
        data: { name: newName, logo: newLogo },
      });
    }
  } else {
    try {
      team = await prisma.team.create({
        data: {
          api_team_id: teamApi.id,
          name: teamApi.name ?? "Unknown",
          logo: teamApi.logo ?? null,
          league_id: leagueId,
        },
      });
    } catch (err) {
      if (err?.code === "P2002") {
        team = await prisma.team.findUnique({
          where: { api_team_id: teamApi.id },
        });
      } else {
        throw err;
      }
    }
  }

  teamCache.set(teamApi.id, team);
  return team;
}

async function upsertFixtureRow(entry, leagueId, homeTeamId, awayTeamId) {
  const f = entry.fixture ?? entry;
  if (!f?.id)
    return { upserted: false, fixtureId: null, becameTerminal: false };

  const status = STATUS_MAP[f.status?.short] ?? "NS";
  const startTime = new Date(f.date);
  // For terminal fixtures, home/away score is the 90' regulation score
  // (`score.fulltime`), NOT the ET-inclusive `goals` — so Match Winner and all
  // other full-time markets settle on regulation. Live fixtures keep `goals`.
  const { homeScore, awayScore, etHome, etAway, penHome, penAway } =
    resolveFixtureScores(entry, {
      preferFullTime: isTerminalFixtureStatus(status),
    });
  // Half-time scores live under `score.halftime` in the API-Sports /fixtures
  // payload (separate from `goals`, which is the current/full-time score).
  // Required by HT markets (HALF_TIME_RESULT, HT_OVER_UNDER, HT_FT).
  const htHomeScore = entry?.score?.halftime?.home ?? null;
  const htAwayScore = entry?.score?.halftime?.away ?? null;

  // Inline upsert with shallow-equality guard. The previous helper
  // (`upsertNoTx`) always issued an `update` after the `findUnique`, even
  // when nothing changed – this is the dominant source of MongoDB write
  // amplification on recurring fixture syncs.
  const existing = await prisma.fixture.findUnique({
    where: { api_fixture_id: f.id },
  });

  // A fixture should be settled the first time we see it transition into
  // a terminal status (FT/AET/PEN/CANC/...). The settlement service is
  // idempotent through `Fixture.settled_at`, but evaluating
  // "becameTerminal" here lets us skip the call for fixtures that are
  // already historic on every sync tick.
  const wasTerminalBefore = existing
    ? isTerminalFixtureStatus(existing.status)
    : false;
  const isTerminalNow = isTerminalFixtureStatus(status);
  const becameTerminal = !wasTerminalBefore && isTerminalNow;

  if (existing) {
    const incoming = {
      start_time: startTime,
      status,
      home_score: homeScore,
      away_score: awayScore,
      ht_home_score: htHomeScore,
      ht_away_score: htAwayScore,
      et_home_score: etHome,
      et_away_score: etAway,
      pen_home_score: penHome,
      pen_away_score: penAway,
      league_id: leagueId,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
    };
    if (fixtureSyncUnchanged(existing, incoming)) {
      return {
        upserted: true,
        fixtureId: existing.id,
        becameTerminal: false,
      };
    }

    await prisma.fixture.update({
      where: { api_fixture_id: f.id },
      data: buildFixtureSyncData(existing, incoming),
    });
    return {
      upserted: true,
      fixtureId: existing.id,
      becameTerminal,
    };
  }

  try {
    const created = await prisma.fixture.create({
      data: {
        api_fixture_id: f.id,
        start_time: startTime,
        status,
        home_score: homeScore,
        away_score: awayScore,
        ht_home_score: htHomeScore,
        ht_away_score: htAwayScore,
        et_home_score: etHome,
        et_away_score: etAway,
        pen_home_score: penHome,
        pen_away_score: penAway,
        league_id: leagueId,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
      },
    });
    return {
      upserted: true,
      fixtureId: created.id,
      // A brand-new row that's already terminal still warrants
      // settlement (e.g. backfilling historic results).
      becameTerminal: isTerminalNow,
    };
  } catch (err) {
    // Concurrent insert race: another job created the row between our
    // findUnique and create. Fall back to update so we still converge.
    if (err?.code !== "P2002") throw err;
    const raceExisting = await prisma.fixture.findUnique({
      where: { api_fixture_id: f.id },
    });
    const incoming = {
      start_time: startTime,
      status,
      home_score: homeScore,
      away_score: awayScore,
      ht_home_score: htHomeScore,
      ht_away_score: htAwayScore,
      et_home_score: etHome,
      et_away_score: etAway,
      pen_home_score: penHome,
      pen_away_score: penAway,
      league_id: leagueId,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
    };
    const updated = await prisma.fixture.update({
      where: { api_fixture_id: f.id },
      data: buildFixtureSyncData(raceExisting || {}, incoming),
    });
    return {
      upserted: true,
      fixtureId: updated.id,
      becameTerminal,
    };
  }
}

async function safeSettleFixture(fixtureId, sportSlug) {
  if (!fixtureId) return null;
  try {
    // Enrich first so V2 can grade event-based markets on this run.
    // No-op (returns `{ enriched: false }`) when the env flag is off.
    await enrichFixtureResult(fixtureId, { sport: sportSlug }).catch((err) => {
      console.warn(
        `[syncFixtures] enrichment errored fixture=${fixtureId}:`,
        err?.message || err,
      );
    });
    return await settleFixture(fixtureId);
  } catch (err) {
    console.error(
      `[syncFixtures] settlement failed for fixture ${fixtureId}:`,
      err?.message || err,
    );
    return null;
  }
}

/**
 * Upsert fixtures for one sport/date slice (pre-fetched upstream payload).
 */
async function processDateFixtures(
  sportSlug,
  providerName,
  date,
  fixtures,
  caches,
  ingestEligible,
) {
  const sport = await getOrUpsertSport(
    sportSlug,
    providerName,
    caches.sportCache,
  );

  console.log(
    `[syncFixtures] ${sportSlug} ${date}: upstream fixtures=${fixtures.length}, ingestEligible=${ingestEligible.size}`,
  );

  let upserts = 0;
  let skipped = 0;
  let settledCount = 0;
  let ticketsSettled = 0;
  let payoutsCredited = 0;

  for (const entry of fixtures) {
    const f = entry.fixture ?? entry;
    const teams = entry.teams;
    if (!f?.id || !teams?.home?.id || !teams?.away?.id) {
      skipped++;
      continue;
    }

    const apiLeagueId = entry.league?.id;
    if (!apiLeagueId || !ingestEligible.has(apiLeagueId)) {
      skipped++;
      continue;
    }

    const league = await upsertLeagueFromEntry(
      entry,
      sport.id,
      caches.leagueCache,
    );
    if (!league) {
      skipped++;
      continue;
    }

    const homeTeam = await upsertTeamFromEntry(
      teams.home,
      league.id,
      caches.teamCache,
    );
    const awayTeam = await upsertTeamFromEntry(
      teams.away,
      league.id,
      caches.teamCache,
    );
    if (!homeTeam || !awayTeam) {
      skipped++;
      continue;
    }

    const outcome = await upsertFixtureRow(
      entry,
      league.id,
      homeTeam.id,
      awayTeam.id,
    );
    if (outcome.upserted) upserts++;
    else skipped++;

    if (outcome.becameTerminal && outcome.fixtureId) {
      const settled = await safeSettleFixture(outcome.fixtureId, sportSlug);
      if (settled && !settled.skipped) {
        settledCount += 1;
        ticketsSettled +=
          (settled.ticketsWon || 0) + (settled.ticketsLost || 0);
        payoutsCredited += settled.payoutsCredited || 0;
      }
    }
  }

  console.log(
    `[syncFixtures] ${sportSlug} ${date}: upserted=${upserts}, skipped=${skipped}, settled=${settledCount}, ticketsSettled=${ticketsSettled}, payoutsCredited=${payoutsCredited}`,
  );
  return {
    upserts,
    skipped,
    settled: settledCount,
    ticketsSettled,
    payoutsCredited,
  };
}

/**
 * Bulk ingest fixtures for a UTC date range.
 *
 * Provide **one** of:
 * - `daysAhead` — legacy alias for offsets `0 .. daysAhead-1`
 * - `startOffset` / `endOffset` — inclusive day offsets from today UTC
 * - `dates` — explicit `YYYY-MM-DD` strings
 */
export async function runFixturesBulkByDate(opts = {}) {
  const enabled = getEnabledSports();
  if (!enabled.length) {
    console.warn("[syncFixtures] no enabled sports – nothing to do");
    return { totalUpserts: 0, totalSkipped: 0 };
  }

  const horizonDefault = getFixturesDaysAhead();
  let dates;
  if (Array.isArray(opts.dates) && opts.dates.length > 0) {
    dates = opts.dates;
  } else if (
    opts.startOffset !== undefined ||
    opts.endOffset !== undefined
  ) {
    const start = opts.startOffset ?? 0;
    const end = opts.endOffset ?? start;
    dates = offsetsToDates(start, end);
  } else {
    const daysAhead =
      Number(opts.daysAhead) > 0
        ? Math.floor(Number(opts.daysAhead))
        : horizonDefault;
    dates = offsetsToDates(0, daysAhead - 1);
  }
  console.log(
    `[syncFixtures] bulk-by-date starting – sports=${enabled.join(",")}, days=${dates.length} (${dates[0]} → ${dates[dates.length - 1]})`,
  );

  // Per-run caches so we don't hammer Mongo with the same upserts repeatedly
  // when a league or team appears across multiple dates.
  const caches = {
    sportCache: new Map(),
    leagueCache: new Map(),
    teamCache: new Map(),
  };

  let totalUpserts = 0;
  let totalSkipped = 0;
  let totalSettled = 0;
  let totalTicketsSettled = 0;
  let totalPayoutsCredited = 0;

  const ingestCap = getIngestActiveCap();

  for (const sportSlug of enabled) {
    /** @type {Array<{ date: string, fixtures: unknown[] }>} */
    const buffered = [];
    /** @type {Map<number, number>} */
    const leagueActivity = new Map();

    for (const date of dates) {
      try {
        const fixtures = await api(sportSlug).getFixturesByDate(date);
        buffered.push({ date, fixtures });
        for (const entry of fixtures) {
          const apiLeagueId = entry.league?.id;
          if (!apiLeagueId) continue;
          leagueActivity.set(
            apiLeagueId,
            (leagueActivity.get(apiLeagueId) ?? 0) + 1,
          );
        }
      } catch (err) {
        console.error(
          `[syncFixtures] ${sportSlug} ${date} fetch failed:`,
          err.message,
        );
      }
      await sleep(DATE_CALL_DELAY_MS);
    }

    const ingestEligible = pickTopActiveLeagues(
      leagueActivity.keys(),
      ingestCap,
    );
    for (const id of PRODUCT_PRIORITY_LEAGUE_IDS) {
      if (leagueActivity.has(id)) ingestEligible.add(id);
    }
    console.log(
      `[syncFixtures] ${sportSlug} rank gate – activeLeagues=${leagueActivity.size}, ingestCap=${ingestCap}, eligible=${ingestEligible.size}`,
    );

    for (const { date, fixtures } of buffered) {
      try {
        const result = await processDateFixtures(
          sportSlug,
          sportSlug,
          date,
          fixtures,
          caches,
          ingestEligible,
        );
        totalUpserts += result.upserts;
        totalSkipped += result.skipped;
        totalSettled += result.settled || 0;
        totalTicketsSettled += result.ticketsSettled || 0;
        totalPayoutsCredited += result.payoutsCredited || 0;
      } catch (err) {
        console.error(
          `[syncFixtures] ${sportSlug} ${date} upsert failed:`,
          err.message,
        );
      }
    }
  }

  // Keep by-date list caches warm (home page). Invalidate other list keys
  // that are not rebuilt here.
  await deleteByPattern("fixtures:today:*");
  await deleteByPattern("fixtures:upcoming:*");
  await deleteByPattern("live:fixtures:*");
  try {
    const refreshed = await refreshFixturesByDateCaches();
    console.log(
      `[syncFixtures] fixtures by-date refreshed:`,
      refreshed.map((r) => `${r.ymd}=${r.count ?? r.error}`).join(", "),
    );
  } catch (err) {
    console.error(
      "[syncFixtures] fixtures by-date refresh failed:",
      err?.message || err,
    );
    // Keep existing by-date keys — stale data beats a cold miss for visitors.
  }

  console.log(
    `[syncFixtures] bulk-by-date done – upserts=${totalUpserts}, skipped=${totalSkipped}, settled=${totalSettled}, ticketsSettled=${totalTicketsSettled}, payoutsCredited=${totalPayoutsCredited}, days=${dates.length}, leaguesSeen=${caches.leagueCache.size}, teamsSeen=${caches.teamCache.size}`,
  );

  return {
    totalUpserts,
    totalSkipped,
    totalSettled,
    totalTicketsSettled,
    totalPayoutsCredited,
  };
}

/**
 * Default export preserved for backwards compatibility (e.g. the legacy
 * inline `RUN_WORKER_INLINE` cron path). It uses FIXTURES_DAYS_AHEAD (default 14).
 */
export default async function syncFixtures() {
  return runFixturesBulkByDate({ daysAhead: getFixturesDaysAhead() });
}
