import prisma from "../Config/db.js";
import { api } from "../services/apiSportsService.js";
import { deleteByPattern } from "../services/cacheService.js";
import { refreshFixturesByDateCaches } from "../services/fixturesListService.js";
import { getEnabledSports } from "../services/sportsRegistry.js";
import { getPreferredBookmakerApiId } from "../services/settingsService.js";
import { buildOddsParseOptions } from "../Config/oddsFilters.js";
import { lockFixture } from "../services/odds-engine/liveFixtureLock.js";
import { STATUS_MAP, MAJOR_LIVE_STATES } from "./lib/liveStatus.js";
import {
  LIVE_MARKET_LOCK_MS,
  updateFixtureScore,
  refreshFixtureOdds,
} from "./lib/liveFixtureRefresh.js";
import { resolveFixtureScores } from "./lib/fixtureScores.js";
import {
  isTerminalFixtureStatus,
  settleFixture,
} from "../services/ticketSettlementService.js";
import { enrichFixtureResult } from "./enrichFixtureResult.js";

/**
 * Live fixtures poller (the "slow" / authoritative poll).
 *
 * Owns Mongo score/status correctness and the per-fixture odds refresh. Goal
 * detection + the fixture lock are now driven within ~5s by the dedicated fast
 * score poller (`syncLiveScores`), so this poller runs at a relaxed cadence
 * (LIVE_POLL_SECONDS, default 60s) and acts as the backstop: NS→LIVE odds
 * backfill, zero-market backfill, and Mongo correctness for anything the fast
 * poll missed.
 *
 * Concurrency is owned by the BullMQ queue (`sync-live`, concurrency=1) – two
 * ticks can never overlap because the queue processes them strictly in series.
 */

const LIVE_EVENT_FREEZE_MS = Math.max(
  1000,
  Number(process.env.LIVE_EVENT_FREEZE_MS || 3000),
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function syncLiveFixtures() {
  try {
    const enabled = getEnabledSports();
    if (!enabled.length) return;

    // Resolve the single-bookmaker policy once per tick.
    const preferredApiId = await getPreferredBookmakerApiId();
    const parseOptions = buildOddsParseOptions(preferredApiId);

    let updated = 0;

    for (const sportSlug of enabled) {
      const liveData = await api(sportSlug).getLiveFixtures();
      if (!liveData.length) continue;

      for (const entry of liveData) {
        const f = entry.fixture ?? entry;
        const goals = entry.goals ?? entry.scores ?? {};
        if (!f?.id) continue;

        const existing = await prisma.fixture.findUnique({
          where: { api_fixture_id: f.id },
          include: { league: { include: { sport: true } } },
        });
        if (!existing) continue;
        if (existing.league?.sport?.slug !== sportSlug) continue;

        const status = STATUS_MAP[f.status?.short] ?? "LIVE";
        // Terminal fixtures persist the 90' regulation score; live fixtures keep
        // the running `goals` so the in-play score stays correct.
        const { homeScore, awayScore, etHome, etAway, penHome, penAway } =
          resolveFixtureScores(entry, {
            preferFullTime: isTerminalFixtureStatus(status),
          });
        const scoreChanged =
          existing.home_score !== homeScore ||
          existing.away_score !== awayScore;
        const statusChanged = existing.status !== status;
        const statusBecameLive = existing.status === "NS" && status === "LIVE";
        const majorStateChanged =
          statusChanged &&
          (MAJOR_LIVE_STATES.has(existing.status) ||
            MAJOR_LIVE_STATES.has(status));
        const shouldFreeze = scoreChanged || majorStateChanged;
        let freezeOk = true;
        if (shouldFreeze) {
          // Plane-1 fixture-level event lock (snapshot-independent global
          // override). Self-expiring; refreshFixtureOdds re-arms it just before
          // the snapshot reveal. No explicit unlock.
          const locked = await lockFixture(f.id, {
            reason: scoreChanged ? "score_change" : "state_change",
            lockMs: LIVE_MARKET_LOCK_MS,
          });
          freezeOk = Boolean(locked);
          if (freezeOk) {
            await sleep(LIVE_EVENT_FREEZE_MS);
          } else {
            // Fail-closed: the freeze could not be guaranteed (Redis write
            // failed). Skip the refresh so we never publish a fresh OPEN
            // snapshot on an unfrozen fixture. The next tick / fast poll retries.
            console.warn(
              `[syncLive] lockFixture failed for fixture ${f.id}; skipping odds refresh this tick (fail-closed)`,
            );
          }
        }

        // Persist score/status (honours admin result lock internally).
        if (scoreChanged || statusChanged) {
          await updateFixtureScore(existing, {
            status,
            homeScore,
            awayScore,
            etHome,
            etAway,
            penHome,
            penAway,
          });
        }

        // Trigger settlement when fixture transitions to terminal status (PEN).
        // The live API returns status "P" during penalty shootout, which maps
        // to "PEN" (a terminal status). Without this, the scheduled sync sees
        // the fixture already terminal and skips settlement.
        const wasTerminal = isTerminalFixtureStatus(existing.status);
        const isTerminalNow = isTerminalFixtureStatus(status);
        if (!wasTerminal && isTerminalNow && existing.id) {
          try {
            await enrichFixtureResult(existing.id, { sport: sportSlug }).catch(() => {});
            const settled = await settleFixture(existing.id);
            if (settled && !settled.skipped) {
              console.log(
                `[syncLive] settled fixture=${existing.id} status=${status} graded=${settled.selectionsUpdated}`,
              );
            }
          } catch (err) {
            console.error(
              `[syncLive] settlement failed fixture=${existing.id}:`,
              err?.message || err,
            );
          }
        }

        // Defer the markets `count` query until we actually need it.
        let needsOddsRefresh = scoreChanged || statusBecameLive;
        if (!needsOddsRefresh) {
          const marketCount = await prisma.fixtureMarket.count({
            where: { fixture_id: existing.id },
          });
          needsOddsRefresh = marketCount === 0;
        }

        // Gate on freezeOk: when a freeze was required but the lock write
        // failed, do NOT publish a fresh OPEN snapshot this tick (fail-closed).
        if (needsOddsRefresh && freezeOk) {
          await refreshFixtureOdds({
            sportSlug,
            existing,
            apiFixtureId: f.id,
            parseOptions,
            lockReason: scoreChanged ? "score_change" : "state_change",
          });
        }

        if (scoreChanged || statusChanged || needsOddsRefresh) {
          updated++;
        }
      }
    }

    if (updated > 0) {
      // Blow away live/today caches; rebuild by-date so home stays warm.
      await deleteByPattern("live:fixtures:*");
      await deleteByPattern("fixtures:today:*");
      try {
        await refreshFixturesByDateCaches();
      } catch (err) {
        console.error(
          "[syncLive] fixtures by-date refresh failed:",
          err?.message || err,
        );
        // Keep existing by-date keys — stale data beats a cold miss for visitors.
      }
    }
  } catch (err) {
    console.error("[syncLive] error:", err);
  }
}
