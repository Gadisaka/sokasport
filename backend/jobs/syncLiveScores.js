import prisma from "../Config/db.js";
import { api } from "../services/apiSportsService.js";
import { getEnabledSports } from "../services/sportsRegistry.js";
import { getPreferredBookmakerApiId } from "../services/settingsService.js";
import { buildOddsParseOptions } from "../Config/oddsFilters.js";
import { getRedisClient } from "../services/cacheService.js";
import { lockFixture } from "../services/odds-engine/liveFixtureLock.js";
import { mapApiStatus, detectChange } from "./lib/liveStatus.js";
import {
  encodeScore,
  parseScore,
  classifyScoreChange,
  readScoreCache,
  writeScoreCache,
} from "./lib/liveScoreCache.js";
import {
  LIVE_MARKET_LOCK_MS,
  updateFixtureScore,
  refreshFixtureOdds,
} from "./lib/liveFixtureRefresh.js";
import { resolveFixtureScores } from "./lib/fixtureScores.js";
import { isTerminalFixtureStatus } from "../services/ticketSettlementService.js";

/**
 * Fast score-only poller.
 *
 * Runs every ~5s (LIVE_SCORE_POLL_SECONDS) on its OWN BullMQ queue/worker
 * (`sync-live-scores`, concurrency=1), independent of the relaxed 60s odds
 * poller. Its sole job is to detect a score/state change ASAP and drive the
 * fixture lock + a targeted odds refresh — cutting goal-detection latency from
 * ~30s to ~5s + provider feed lag.
 *
 * The light path (no change) costs ONE bulk `getLiveFixtures()` call per sport
 * plus a batched Redis read of the `live-score:*` baseline — no Mongo. Only a
 * genuine delta drops to Mongo + refresh. Because it writes Mongo on the event,
 * the 60s slow poller then sees no change and does not double-refresh; the slow
 * poller remains the backstop for NS→LIVE / zero-market / Mongo correctness.
 */

const SCORE_POLL_SECONDS = Math.max(
  1,
  Number(process.env.LIVE_SCORE_POLL_SECONDS || 5),
);
// Generous margin so a delayed tick (HT spike, brief backlog) or a momentary
// Redis hiccup never drops the baseline mid-match — a re-seed would take the
// light path and silently miss the goal that landed in the gap. The only cost
// of a long TTL is that an ended fixture's baseline lingers a bit before it
// expires, which is harmless. Floor of 60s, or 12× the poll interval.
const SCORE_CACHE_TTL_SECONDS = Math.max(60, SCORE_POLL_SECONDS * 12);

export default async function syncLiveScores() {
  try {
    const enabled = getEnabledSports();
    if (!enabled.length) return;
    const redis = getRedisClient();

    // Resolve once per tick; only used on the heavy (refresh) branch.
    const preferredApiId = await getPreferredBookmakerApiId();
    const parseOptions = buildOddsParseOptions(preferredApiId);

    for (const sportSlug of enabled) {
      const liveData = await api(sportSlug).getLiveFixtures();
      if (!liveData.length) continue;

      // Build comparable tuples, then batch-read the baseline in one pipeline.
      const items = [];
      for (const entry of liveData) {
        const f = entry.fixture ?? entry;
        if (!f?.id) continue;
        const status = mapApiStatus(f.status?.short);
        // Terminal fixtures persist the 90' regulation score; live fixtures keep
        // the running `goals`. ET/pen carried through for the Mongo write.
        const { homeScore, awayScore, etHome, etAway, penHome, penAway } =
          resolveFixtureScores(entry, {
            preferFullTime: isTerminalFixtureStatus(status),
          });
        const next = {
          homeScore,
          awayScore,
          status,
          etHome,
          etAway,
          penHome,
          penAway,
        };
        items.push({ id: f.id, next, cur: encodeScore(next) });
      }
      if (!items.length) continue;

      const cache = await readScoreCache(
        redis,
        items.map((it) => it.id),
      );

      for (const { id, next, cur } of items) {
        const cached = cache.get(id) ?? null;
        const action = classifyScoreChange(cur, cached);

        // First sight or unchanged: just (re)seed the baseline TTL. No lock,
        // no Mongo — this is the light path the 5s cadence relies on.
        if (action === "seed" || action === "skip") {
          await writeScoreCache(redis, id, cur, SCORE_CACHE_TTL_SECONDS);
          continue;
        }

        // action === "changed": a real in-play delta vs our baseline.
        const { scoreChanged, shouldFreeze } = detectChange(
          parseScore(cached),
          next,
        );

        // Freeze IMMEDIATELY (before the DB/API latency below) so the snipe
        // window closes the instant we detect the event. Fail-closed and
        // symmetric with the slow poller: if the lock write fails, do NOT touch
        // Mongo, refresh, or the baseline — `continue` so this delta is retried
        // next tick (and the 60s slow poller, which still sees the old Mongo
        // score, remains a backstop).
        if (shouldFreeze) {
          const locked = await lockFixture(id, {
            reason: scoreChanged ? "score_change" : "state_change",
            lockMs: LIVE_MARKET_LOCK_MS,
          });
          if (!locked) {
            console.warn(
              `[syncLiveScores] lockFixture failed for fixture ${id}; skipping this tick (fail-closed)`,
            );
            continue;
          }
        }

        try {
          // Authoritative DB lookup only on this heavy branch.
          const existing = await prisma.fixture.findUnique({
            where: { api_fixture_id: id },
            include: { league: { include: { sport: true } } },
          });
          if (!existing || existing.league?.sport?.slug !== sportSlug) {
            // Untracked / wrong-sport fixture: advance the baseline so we don't
            // re-lock it every tick. Nothing else to do.
            await writeScoreCache(redis, id, cur, SCORE_CACHE_TTL_SECONDS);
            continue;
          }

          await updateFixtureScore(existing, next);

          // Only a score change warrants pulling fresh odds (parity with the
          // slow poller, which refreshes on scoreChanged, not on a pure state
          // change). refreshFixtureOdds re-arms the lock before the snapshot.
          if (scoreChanged) {
            await refreshFixtureOdds({
              sportSlug,
              existing,
              apiFixtureId: id,
              parseOptions,
              lockReason: "score_change",
            });
          }

          // Advance the baseline ONLY after the heavy work succeeded, so a
          // Mongo/API failure leaves Redis behind and the delta is retried next
          // tick (rather than being marked "skip" and silently dropped).
          await writeScoreCache(redis, id, cur, SCORE_CACHE_TTL_SECONDS);
        } catch (err) {
          // Per-fixture isolation: one bad fixture must not abort the whole
          // tick. Baseline left un-advanced → retried next tick.
          console.error(
            `[syncLiveScores] failed processing fixture ${id}:`,
            err?.message || err,
          );
        }
      }
    }
  } catch (err) {
    console.error("[syncLiveScores] error:", err);
  }
}
