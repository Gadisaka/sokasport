/**
 * Settlement retry job — the self-healing safety net.
 *
 * Two scans per tick:
 *
 * 1. TERMINAL SCAN — every terminal fixture (FT/AET/PEN/AWD/WO/CANC/ABD/PST)
 *    whose `grading_completed_at` is UNSET (explicitly null OR the field is
 *    missing from the Mongo document) gets `settleFixture` re-run. On
 *    MongoDB, rows created by the sync jobs never write the settlement
 *    bookkeeping fields, so they are ABSENT — and Prisma's `{ field: null }`
 *    does NOT match absent fields. The previous query used plain null
 *    filters and therefore matched nothing, which is why PEN/PST fixtures
 *    stayed stuck forever. `isSet: false` is the Mongo-aware filter.
 *
 * 2. ZOMBIE SCAN — fixtures past kickoff that are still NON-terminal
 *    (NS/LIVE/HT/…) but carry at least one PENDING ticket leg. These fall
 *    through the bulk date sync (e.g. leagues the daily sync no longer
 *    covers), so their result never arrives on its own. We fetch the result
 *    directly by fixture id from API-Sports, update status/scores, and
 *    settle. Scoped to fixtures with real money on them, so upstream volume
 *    stays tiny.
 *
 * PST fixtures honour the 72h postponed wait (`lib/postponedSettlement`):
 * the retry skips them until the wait expires, then voids the legs. Without
 * this gate the retry's `force: true` would bypass the wait and void
 * freshly-postponed fixtures that may still be rescheduled.
 *
 * Runs on the `settlement-retry` repeatable queue (default every 5 min).
 * Bounded per tick: SETTLEMENT_RETRY_BATCH terminal fixtures and
 * SETTLEMENT_ZOMBIE_BATCH zombie fixtures.
 *
 * @module jobs/settlementRetry
 */
import prisma from "../Config/db.js";
import { api, sleep } from "../services/apiSportsService.js";
import { settleFixture } from "../services/ticketSettlementService.js";
import { enrichFixtureResult } from "./enrichFixtureResult.js";
import { STATUS_MAP } from "./syncFixtures.js";
import { resolveFixtureScores } from "./lib/fixtureScores.js";
import {
  buildFixtureSyncData,
  isFixtureResultLocked,
} from "../lib/fixtureResultLock.js";
import { evaluatePostponedSettlementWait } from "../lib/postponedSettlement.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { recordUnresolvableFixture } from "../lib/settlementMetrics.js";

const DEFAULT_BATCH = Number(process.env.SETTLEMENT_RETRY_BATCH || 50);
// Only retry fixtures whose start_time is within the last N days so we
// don't thrash the DB scanning ancient rows that will never resolve.
const MAX_AGE_DAYS = Number(process.env.SETTLEMENT_RETRY_MAX_AGE_DAYS || 14);
// A terminal fixture still carrying pending legs this many hours after kickoff
// is treated as effectively unresolvable under the active engine. Surface it
// as a CRITICAL alert + metric instead of retrying it silently forever.
const STUCK_CRITICAL_HOURS = Number(
  process.env.SETTLEMENT_STUCK_CRITICAL_HOURS || 6,
);
// Zombie rescue: a fixture is a candidate once kickoff is this many hours
// in the past and its status is still non-terminal.
const ZOMBIE_STALE_HOURS = Number(
  process.env.SETTLEMENT_ZOMBIE_STALE_HOURS || 3,
);
// Upstream calls per tick are capped: one /fixtures?id= call per zombie.
const ZOMBIE_BATCH = Number(process.env.SETTLEMENT_ZOMBIE_BATCH || 25);
// Pause between by-id upstream calls so a big backlog doesn't burst.
const ZOMBIE_FETCH_DELAY_MS = Number(
  process.env.SETTLEMENT_ZOMBIE_FETCH_DELAY_MS || 300,
);

const TERMINAL_STATUSES = ["FT", "AET", "PEN", "AWD", "WO", "CANC", "ABD", "PST"];

/**
 * Mongo-aware "field is not set" filter: matches explicit null AND
 * missing-from-document. Plain `{ field: null }` only matches explicit null
 * on MongoDB, which silently skips every row the sync jobs created.
 */
function unsetFilter(field) {
  return { OR: [{ [field]: null }, { [field]: { isSet: false } }] };
}

/**
 * Re-settle terminal fixtures whose grading never completed.
 */
async function retryTerminalFixtures(now, minStart) {
  const criticalAgeMs = STUCK_CRITICAL_HOURS * 60 * 60 * 1000;

  const stuck = await prisma.fixture.findMany({
    where: {
      AND: [
        { start_time: { gte: minStart } },
        { status: { in: TERMINAL_STATUSES } },
        unsetFilter("grading_completed_at"),
      ],
    },
    select: {
      id: true,
      api_fixture_id: true,
      status: true,
      start_time: true,
      postponed_at: true,
    },
    take: DEFAULT_BATCH,
    orderBy: { start_time: "asc" },
  });

  let retried = 0;
  let completed = 0;
  let stillPending = 0;
  let unresolvable = 0;
  let postponedWaiting = 0;

  for (const fx of stuck) {
    try {
      // PST grace period: the retry runs settleFixture with force (to bypass
      // the grading_completed_at gate), which ALSO bypasses the postponed
      // wait inside settleFixture. Gate here instead so freshly-postponed
      // fixtures keep their 72h reschedule window.
      const wait = evaluatePostponedSettlementWait(fx);
      if (!wait.ok) {
        postponedWaiting++;
        continue;
      }

      // Try to enrich first — if the only reason the leg was pending
      // was missing events/stats, this unblocks the next settleFixture
      // call. Enrichment is a no-op when the env flag is off or the
      // fixture is already enriched.
      await enrichFixtureResult(fx.id).catch(() => {});
      const result = await settleFixture(fx.id, { force: true });
      retried++;
      if (result?.gradingCompleted) {
        completed++;
        continue;
      }
      stillPending++;

      // Retry-loop / unresolvable detection: a terminal fixture that is STILL
      // pending well past kickoff will keep failing every 5 minutes under the
      // active engine. Raise it once per tick as CRITICAL so it can't hide in
      // the retry loop.
      const ageMs = fx.start_time
        ? now - new Date(fx.start_time).getTime()
        : Infinity;
      if (ageMs >= criticalAgeMs) {
        unresolvable++;
        recordUnresolvableFixture();
        console.error(
          `[settlementRetry] SETTLEMENT_STUCK_CRITICAL fixture=${fx.id} ` +
            `api_fixture_id=${fx.api_fixture_id} status=${fx.status} ` +
            `ageHours=${(ageMs / 3_600_000).toFixed(1)} pending=${result?.pendingLegsRemaining ?? "?"} ` +
            `— terminal fixture still has pending legs; likely unresolvable under the active engine`,
        );
        logAuditEvent({
          action: "SETTLEMENT_STUCK_CRITICAL",
          module: "SETTLEMENT",
          entityType: "FIXTURE",
          entityId: fx.id,
          before: null,
          after: {
            apiFixtureId: fx.api_fixture_id,
            status: fx.status,
            ageHours: Number((ageMs / 3_600_000).toFixed(1)),
            pendingLegsRemaining: result?.pendingLegsRemaining ?? null,
            engine: result?.engine ?? null,
          },
        }).catch(() => {});
      }
    } catch (err) {
      stillPending++;
      console.error(
        `[settlementRetry] failed fixture=${fx.id} api_fixture_id=${fx.api_fixture_id}:`,
        err?.message || err,
      );
    }
  }

  return {
    scanned: stuck.length,
    retried,
    completed,
    stillPending,
    unresolvable,
    postponedWaiting,
  };
}

/**
 * Rescue "zombie" fixtures: past kickoff, still non-terminal, with at least
 * one PENDING ticket leg. The bulk date sync will never update these when
 * the league drops out of the daily slate, so we pull each one's result
 * directly by fixture id and settle.
 */
async function rescueZombieFixtures(now, minStart) {
  const staleCutoff = new Date(now - ZOMBIE_STALE_HOURS * 60 * 60 * 1000);

  // Only fixtures with actual money on them qualify — this is what keeps
  // the by-id upstream volume negligible.
  const pendingLegs = await prisma.ticketSelection.findMany({
    where: { result: "PENDING", fixture_id: { not: null } },
    select: { fixture_id: true },
    distinct: ["fixture_id"],
  });
  const ids = pendingLegs.map((l) => l.fixture_id).filter(Boolean);
  if (!ids.length) {
    return { candidates: 0, refreshed: 0, settled: 0, failed: 0 };
  }

  const zombies = await prisma.fixture.findMany({
    where: {
      id: { in: ids },
      status: { notIn: TERMINAL_STATUSES },
      start_time: { gte: minStart, lte: staleCutoff },
    },
    include: { league: { include: { sport: true } } },
    take: ZOMBIE_BATCH,
    orderBy: { start_time: "asc" },
  });

  let refreshed = 0;
  let settled = 0;
  let failed = 0;

  for (const fx of zombies) {
    try {
      // Admin has pinned this result — never overwrite from upstream.
      if (isFixtureResultLocked(fx)) continue;

      const sportSlug = fx.league?.sport?.slug || "football";
      const rows = await api(sportSlug).getFixtureById(fx.api_fixture_id);
      const entry = Array.isArray(rows) ? rows[0] : null;
      if (!entry) {
        failed++;
        console.warn(
          `[settlementRetry] zombie fetch returned nothing fixture=${fx.id} api_fixture_id=${fx.api_fixture_id}`,
        );
        continue;
      }

      const f = entry.fixture ?? entry;
      const status = STATUS_MAP[f?.status?.short] ?? fx.status;
      // Terminal fixtures persist the 90' regulation score (`score.fulltime`)
      // so Match Winner et al. settle on regulation, not the ET-inclusive total.
      const { homeScore, awayScore, etHome, etAway, penHome, penAway } =
        resolveFixtureScores(entry, {
          preferFullTime: TERMINAL_STATUSES.includes(status),
        });

      const incoming = {
        start_time: f?.date ? new Date(f.date) : fx.start_time,
        status,
        home_score: homeScore,
        away_score: awayScore,
        ht_home_score: entry?.score?.halftime?.home ?? null,
        ht_away_score: entry?.score?.halftime?.away ?? null,
        et_home_score: etHome,
        et_away_score: etAway,
        pen_home_score: penHome,
        pen_away_score: penAway,
        league_id: fx.league_id,
        home_team_id: fx.home_team_id,
        away_team_id: fx.away_team_id,
      };
      await prisma.fixture.update({
        where: { id: fx.id },
        data: buildFixtureSyncData(fx, incoming),
      });
      refreshed++;
      console.log(
        `[settlementRetry] zombie refreshed fixture=${fx.id} api_fixture_id=${fx.api_fixture_id} ` +
          `${fx.status}→${status} score=${incoming.home_score}-${incoming.away_score}`,
      );

      // PST goes through the postponed 72h wait — the terminal scan owns
      // its timing on a later tick (grading_completed_at is still unset).
      if (TERMINAL_STATUSES.includes(status) && status !== "PST") {
        await enrichFixtureResult(fx.id, { sport: sportSlug }).catch(() => {});
        const result = await settleFixture(fx.id, { force: true });
        if (result && !result.skipped) settled++;
      }
    } catch (err) {
      failed++;
      console.error(
        `[settlementRetry] zombie rescue failed fixture=${fx.id} api_fixture_id=${fx.api_fixture_id}:`,
        err?.message || err,
      );
    }
    await sleep(ZOMBIE_FETCH_DELAY_MS);
  }

  return { candidates: zombies.length, refreshed, settled, failed };
}

/**
 * @returns {Promise<{
 *   scanned: number, retried: number, completed: number,
 *   stillPending: number, unresolvable: number, postponedWaiting: number,
 *   zombies: { candidates: number, refreshed: number, settled: number, failed: number },
 * }>}
 */
export async function runSettlementRetry() {
  const now = Date.now();
  const minStart = new Date(now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  const terminal = await retryTerminalFixtures(now, minStart);
  const zombies = await rescueZombieFixtures(now, minStart);

  console.log(
    `[settlementRetry] scanned=${terminal.scanned} retried=${terminal.retried} ` +
      `completed=${terminal.completed} stillPending=${terminal.stillPending} ` +
      `unresolvable=${terminal.unresolvable} postponedWaiting=${terminal.postponedWaiting} ` +
      `zombies: candidates=${zombies.candidates} refreshed=${zombies.refreshed} ` +
      `settled=${zombies.settled} failed=${zombies.failed}`,
  );
  return { ...terminal, zombies };
}

export default runSettlementRetry;
