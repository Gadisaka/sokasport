import prisma from "../Config/db.js";
import { upsertNoTx } from "../utils/upsertNoTx.js";
import { api } from "../services/apiSportsService.js";
import { deleteByPattern, getRedisClient } from "../services/cacheService.js";
import { refreshFixturesByDateCaches } from "../services/fixturesListService.js";
import { parseMarkets } from "../utils/oddsParser.js";
import { getEnabledSports } from "../services/sportsRegistry.js";
import { getPreferredBookmakerApiId } from "../services/settingsService.js";
import { buildOddsParseOptions } from "../Config/oddsFilters.js";
import { recomputeExtraMarketsCountForFixture } from "../services/extraMarketsCount.js";
import { publishMarketEvent } from "../lib/socketHub.js";
import { isFixtureResultLocked, buildFixtureSyncData } from "../lib/fixtureResultLock.js";
import { resolveFixtureScores } from "./lib/fixtureScores.js";
import {
  writeLiveOddsSnapshot,
  LIVE_ODDS_SNAPSHOT_TTL_SECONDS,
} from "../services/liveOddsCache.js";
import {
  isTerminalFixtureStatus,
  settleFixture,
} from "../services/ticketSettlementService.js";
import { enrichFixtureResult } from "./enrichFixtureResult.js";

/**
 * Live fixtures poller.
 *
 * Concurrency is owned by the BullMQ queue (`sync-live`, concurrency=1)
 * after Phase 4. The previous in-process / Redis run-lock has been removed
 * – two ticks of the live poller can never overlap because the queue
 * processes them strictly in series.
 */

const STATUS_MAP = {
  "1H": "LIVE",
  HT: "HT",
  "2H": "LIVE",
  ET: "LIVE",
  BT: "LIVE",
  P: "PEN",
  LIVE: "LIVE",
};
const LIVE_MARKET_LOCK_MS = Math.max(
  1000,
  Number(process.env.LIVE_MARKET_LOCK_MS || 5000),
);
const LIVE_EVENT_FREEZE_MS = Math.max(
  1000,
  Number(process.env.LIVE_EVENT_FREEZE_MS || 3000),
);
const MAJOR_LIVE_STATES = new Set(["HT", "LIVE", "PEN"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lockFixtureMarkets(apiFixtureId, reason, lockMs) {
  const redis = getRedisClient();
  const stateKey = `live-market-state:${apiFixtureId}`;
  const lockUntilKey = `live-market-lock-until:${apiFixtureId}`;
  const stateMap = await redis.hgetall(stateKey);
  const entries = Object.keys(stateMap || {});
  if (!entries.length) return;
  const lockUntil = Date.now() + lockMs;
  const lockFields = {};
  const lockUntilFields = {};
  for (const field of entries) {
    lockFields[field] = "LOCKED";
    lockUntilFields[field] = lockUntil;
  }
  await redis.hset(stateKey, lockFields);
  await redis.hset(lockUntilKey, lockUntilFields);
  await redis.expire(stateKey, LIVE_ODDS_SNAPSHOT_TTL_SECONDS);
  await redis.expire(lockUntilKey, LIVE_ODDS_SNAPSHOT_TTL_SECONDS);
  await publishMarketEvent({
    event: "market:locked",
    apiFixtureId,
    reason,
    lockUntil,
  });
}

async function unlockFixtureMarkets(apiFixtureId, reason) {
  const redis = getRedisClient();
  const stateKey = `live-market-state:${apiFixtureId}`;
  const lockUntilKey = `live-market-lock-until:${apiFixtureId}`;
  const stateMap = await redis.hgetall(stateKey);
  const entries = Object.keys(stateMap || {});
  if (!entries.length) return;
  const openFields = {};
  for (const field of entries) {
    openFields[field] = "OPEN";
  }
  await redis.hset(stateKey, openFields);
  await redis.del(lockUntilKey);
  await redis.expire(stateKey, LIVE_ODDS_SNAPSHOT_TTL_SECONDS);
  await publishMarketEvent({
    event: "market:unlocked",
    apiFixtureId,
    reason,
  });
}

export default async function syncLiveFixtures() {
  try {
    const enabled = getEnabledSports();
    if (!enabled.length) return;

    // Resolve the single-bookmaker policy once per tick. Same rationale
    // as `syncOdds.js`: drops non-preferred bookmakers / non-allowlisted
    // markets before they ever reach the upsert loop.
    const preferredApiId = await getPreferredBookmakerApiId();
    const parseOptions = buildOddsParseOptions(preferredApiId);

    let updated = 0;

    for (const sportSlug of enabled) {
      const liveData = await api(sportSlug).getLiveFixtures();
      if (!liveData.length) continue;

      for (const entry of liveData) {
        const f = entry.fixture ?? entry;
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
          (MAJOR_LIVE_STATES.has(existing.status) || MAJOR_LIVE_STATES.has(status));
        const shouldFreeze = scoreChanged || majorStateChanged;
        if (shouldFreeze) {
          await lockFixtureMarkets(
            f.id,
            scoreChanged ? "score_change" : "state_change",
            LIVE_MARKET_LOCK_MS,
          );
          await sleep(LIVE_EVENT_FREEZE_MS);
        }

        // Only write when something actually changed. The live poller runs
        // every ~30s; without this guard each tick rewrites every in-play
        // fixture even when scores/status are identical.
        if (scoreChanged || statusChanged) {
          await prisma.fixture.update({
            where: { api_fixture_id: f.id },
            data: buildFixtureSyncData(existing, {
              start_time: existing.start_time,
              status,
              home_score: homeScore,
              away_score: awayScore,
              et_home_score: etHome,
              et_away_score: etAway,
              pen_home_score: penHome,
              pen_away_score: penAway,
              league_id: existing.league_id,
              home_team_id: existing.home_team_id,
              away_team_id: existing.away_team_id,
            }),
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

        // Defer the markets `count` query until we actually need it –
        // when scores/status already prove a refresh is required, we can
        // skip the extra read.
        let needsOddsRefresh = scoreChanged || statusBecameLive;
        if (!needsOddsRefresh) {
          const marketCount = await prisma.fixtureMarket.count({
            where: { fixture_id: existing.id },
          });
          needsOddsRefresh = marketCount === 0;
        }

        if (needsOddsRefresh) {
          await deleteByPattern(`odds:fixture:${f.id}:*`);

          const rawOdds = await api(sportSlug).getOdds(f.id);
          if (rawOdds.length) {
            const parsed = parseMarkets(rawOdds, parseOptions);

            // PERF: This nested loop emits 1+ Mongo round-trips per odd-line
            // (bookmaker × market × value). For the live poller this can be
            // hundreds of writes per fixture per refresh and is a known
            // MongoDB CPU hotspot. Migrating to native `bulkWrite` (with
            // ordered: false) is the next major optimization but is out of
            // scope for this safe pass – leaving the original behavior so
            // existing reads (`/odds/:apiFixtureId`) keep working unchanged.
            for (const bk of parsed.bookmakers) {
              const bookmaker = await upsertNoTx(prisma.bookmaker, {
                where: { api_bookmaker_id: bk.apiBookmakerId },
                update: { name: bk.name },
                create: {
                  api_bookmaker_id: bk.apiBookmakerId,
                  name: bk.name,
                },
              });

              for (const mkt of bk.markets) {
                const market = await upsertNoTx(prisma.fixtureMarket, {
                  where: {
                    fixture_id_name: {
                      fixture_id: existing.id,
                      name: mkt.name,
                    },
                  },
                  update: {},
                  create: { name: mkt.name, fixture_id: existing.id },
                });

                for (const v of mkt.values) {
                  await upsertNoTx(prisma.fixtureOddLine, {
                    where: {
                      market_id_bookmaker_id_value: {
                        market_id: market.id,
                        bookmaker_id: bookmaker.id,
                        value: v.value,
                      },
                    },
                    update: { odd: v.odd },
                    create: {
                      value: v.value,
                      odd: v.odd,
                      market_id: market.id,
                      bookmaker_id: bookmaker.id,
                    },
                  });
                }
              }
            }

            await recomputeExtraMarketsCountForFixture(existing.id);
            await writeLiveOddsSnapshot(f.id, parsed);
            await unlockFixtureMarkets(f.id, "refresh_completed");
          }
          if (shouldFreeze && !rawOdds.length) {
            await unlockFixtureMarkets(f.id, "refresh_empty");
          }
        } else if (shouldFreeze) {
          await unlockFixtureMarkets(f.id, "no_refresh_needed");
        }

        // Only count this row as "updated" when we actually wrote something
        // so the public-cache invalidation below doesn't run for ticks that
        // were complete no-ops.
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
        await deleteByPattern("fixtures:by-date:*");
      }
    }
  } catch (err) {
    console.error("[syncLive] error:", err);
  }
}
