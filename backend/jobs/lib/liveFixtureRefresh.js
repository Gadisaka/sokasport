import prisma from "../../Config/db.js";
import { upsertNoTx } from "../../utils/upsertNoTx.js";
import { api } from "../../services/apiSportsService.js";
import { deleteByPattern } from "../../services/cacheService.js";
import { parseMarkets } from "../../utils/oddsParser.js";
import { recomputeExtraMarketsCountForFixture } from "../../services/extraMarketsCount.js";
import { lockFixture } from "../../services/odds-engine/liveFixtureLock.js";
import { isFixtureResultLocked } from "../../lib/fixtureResultLock.js";
import { writeLiveOddsSnapshot } from "../../services/liveOddsCache.js";

/**
 * Shared per-fixture live write path, extracted from `syncLiveFixtures.js` so
 * the 60s odds poller and the fast score poller perform IDENTICAL effects.
 * Behaviour-preserving relative to the CURRENT inline blocks (the per-field
 * explicit LOCK/UNLOCK control plane was already replaced by the self-expiring
 * fixture-level lock in the prior change — there is no unlock to preserve), with
 * one deliberate addition: `refreshFixtureOdds` re-arms the fixture lock right
 * before publishing the fresh snapshot (see below).
 *
 * `writeLiveOddsSnapshot` is the single canonical writer in
 * `services/liveOddsCache.js` (also used by the resolver's API fallback), so
 * the poller and the fallback share one TTL — no divergent snapshot lifetimes.
 */

export const LIVE_MARKET_LOCK_MS = Math.max(
  1000,
  Number(process.env.LIVE_MARKET_LOCK_MS || 5000),
);

/**
 * Persist a fixture's score/status to Mongo, honouring an admin result lock.
 * Extracted from syncLiveFixtures.js (the `if (!isFixtureResultLocked) update`
 * block). The CALLER decides when something changed; this only writes.
 */
export async function updateFixtureScore(
  existing,
  { status, homeScore, awayScore, etHome, etAway, penHome, penAway } = {},
) {
  if (!existing || isFixtureResultLocked(existing)) return;
  const data = { status, home_score: homeScore, away_score: awayScore };
  // Extra-time / penalty scores only arrive on terminal AET/PEN fixtures.
  // Presence-guard the write so a live tick never clobbers stored values with
  // null (mirrors the HT-score handling in buildFixtureSyncData).
  if (etHome != null) data.et_home_score = etHome;
  if (etAway != null) data.et_away_score = etAway;
  if (penHome != null) data.pen_home_score = penHome;
  if (penAway != null) data.pen_away_score = penAway;
  await prisma.fixture.update({
    where: { api_fixture_id: existing.api_fixture_id },
    data,
  });
}

/**
 * Targeted single-fixture odds refresh: invalidate cache, fetch odds, upsert
 * bookmaker/market/odd-lines, recompute extra-markets count, RE-ARM the fixture
 * lock, then publish the snapshot.
 *
 * The re-arm is the correctness fix: the initial event lock (set by the caller
 * the instant the change was detected) may lapse before this refresh finishes
 * (API latency + nested upserts). Re-arming immediately before the snapshot
 * guarantees the freeze still covers the moment the fresh price becomes
 * visible; the lock then self-expires and the market reopens at the NEW price.
 * Because the lock is monotonic-extend, the re-arm can only lengthen it.
 *
 * Behaviour-preserving vs the original inline block otherwise.
 */
export async function refreshFixtureOdds({
  sportSlug,
  existing,
  apiFixtureId,
  parseOptions,
  lockReason = "refresh",
}) {
  await deleteByPattern(`odds:fixture:${apiFixtureId}:*`);

  const rawOdds = await api(sportSlug).getOdds(apiFixtureId);
  if (!rawOdds.length) return;

  const parsed = parseMarkets(rawOdds, parseOptions);

  // PERF: nested upserts (bookmaker × market × value) — known MongoDB hotspot,
  // preserved as-is from the original poller for behavioural parity.
  for (const bk of parsed.bookmakers) {
    const bookmaker = await upsertNoTx(prisma.bookmaker, {
      where: { api_bookmaker_id: bk.apiBookmakerId },
      update: { name: bk.name },
      create: { api_bookmaker_id: bk.apiBookmakerId, name: bk.name },
    });

    for (const mkt of bk.markets) {
      const market = await upsertNoTx(prisma.fixtureMarket, {
        where: { fixture_id_name: { fixture_id: existing.id, name: mkt.name } },
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
  // Re-arm the lock so the freeze covers the snapshot reveal, then publish.
  await lockFixture(apiFixtureId, { reason: lockReason, lockMs: LIVE_MARKET_LOCK_MS });
  await writeLiveOddsSnapshot(apiFixtureId, parsed);
}
