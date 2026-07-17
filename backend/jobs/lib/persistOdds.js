import prisma from "../../Config/db.js";
import { upsertNoTx } from "../../utils/upsertNoTx.js";
import { setCache, TTL } from "../../services/cacheService.js";
import { recomputeExtraMarketsCountForFixture } from "../../services/extraMarketsCount.js";
import { computeNextOddsCheckAt } from "../../Config/ingestionConfig.js";

export const RAW_ODDS_CACHE_VERSION = 2;

/**
 * Persist a parsed odds payload for one fixture and schedule the next recheck.
 *
 * @param {{ id: string, api_fixture_id: number, start_time?: Date|string }} fixture
 * @param {{ bookmakers: Array }} parsed
 * @param {{ writeRawCache?: boolean }} [opts]
 * @returns {Promise<number>} number of odd-line upserts
 */
export async function persistParsedOddsForFixture(
  fixture,
  parsed,
  opts = {},
) {
  let total = 0;

  for (const bk of parsed.bookmakers ?? []) {
    const bookmaker = await upsertNoTx(prisma.bookmaker, {
      where: { api_bookmaker_id: bk.apiBookmakerId },
      update: { name: bk.name },
      create: { api_bookmaker_id: bk.apiBookmakerId, name: bk.name },
    });

    for (const mkt of bk.markets) {
      const market = await upsertNoTx(prisma.fixtureMarket, {
        where: {
          fixture_id_name: {
            fixture_id: fixture.id,
            name: mkt.name,
          },
        },
        update: {},
        create: { name: mkt.name, fixture_id: fixture.id },
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
        total++;
      }
    }
  }

  await recomputeExtraMarketsCountForFixture(fixture.id);
  await markFixtureOddsChecked(fixture);

  if (opts.writeRawCache !== false) {
    await setCache(
      `odds:fixture:${fixture.api_fixture_id}:raw:v${RAW_ODDS_CACHE_VERSION}`,
      { ...parsed, _cacheVersion: RAW_ODDS_CACHE_VERSION },
      TTL.ODDS,
    );
  }

  return total;
}

/**
 * Record that we attempted odds for this fixture and schedule the next check.
 * Used for both success and empty-result paths so selection slots stay free.
 */
export async function markFixtureOddsChecked(fixture, now = new Date()) {
  const startTime = fixture.start_time ?? now;
  await prisma.fixture.update({
    where: { id: fixture.id },
    data: {
      odds_checked_at: now,
      next_odds_check_at: computeNextOddsCheckAt(startTime, now),
    },
  });
}
