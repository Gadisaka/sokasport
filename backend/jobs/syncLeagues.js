import prisma from "../Config/db.js";
import { upsertNoTx } from "../utils/upsertNoTx.js";
import { api } from "../services/apiSportsService.js";
import { setCache, TTL } from "../services/cacheService.js";
import { getEnabledProviders } from "../services/sportsRegistry.js";

/**
 * Weekly metadata refresher.
 *
 * After Phase 3 the leagues catalogue is populated by the bulk-by-date
 * fixtures ingestion (`syncFixtures.runFixturesBulkByDate`). This job no
 * longer drives the catalogue – it just keeps logos, country flags, and
 * league names in sync with the upstream `/leagues` endpoint, which the
 * fixtures payload doesn't always carry in full.
 *
 * Concurrency: serialized by the BullMQ queue (`sync-leagues-meta`).
 * The legacy in-process / Redis lock has been removed.
 */
export default async function syncLeagues() {
  console.log("[syncLeagues] metadata refresh starting…");

  try {
    const providers = getEnabledProviders();
    if (!providers.length) {
      console.warn("[syncLeagues] no enabled sports – nothing to do");
      return;
    }

    let upserted = 0;
    let updated = 0;

    for (const provider of providers) {
      const sport = await upsertNoTx(prisma.sport, {
        where: { slug: provider.slug },
        update: {},
        create: { name: provider.name, slug: provider.slug },
      });

      const apiLeagues = await api(provider.slug).getLeagues();
      console.log(
        `[syncLeagues/${provider.slug}] upstream returned ${apiLeagues.length} leagues`,
      );

      for (const entry of apiLeagues) {
        const lg = entry.league;
        if (!lg?.id) continue;

        const currentSeason =
          entry.seasons?.find((s) => s.current)?.year ??
          entry.seasons?.[entry.seasons.length - 1]?.year ??
          null;

        const existing = await prisma.league.findUnique({
          where: { api_league_id: lg.id },
        });

        if (existing) {
          await prisma.league.update({
            where: { api_league_id: lg.id },
            data: {
              name: lg.name ?? existing.name,
              country: entry.country?.name ?? existing.country ?? null,
              country_flag:
                entry.country?.flag ?? existing.country_flag ?? null,
              logo: lg.logo ?? existing.logo ?? null,
              season: currentSeason ?? existing.season ?? null,
            },
          });
          updated++;
        } else {
          await prisma.league.create({
            data: {
              api_league_id: lg.id,
              name: lg.name ?? "Unknown",
              country: entry.country?.name ?? null,
              country_flag: entry.country?.flag ?? null,
              logo: lg.logo ?? null,
              season: currentSeason,
              sport_id: sport.id,
              active: true,
            },
          });
          upserted++;
        }
      }
    }

    const allLeagues = await prisma.league.findMany({
      where: { active: true },
      include: { sport: true },
    });
    await setCache("leagues:all", allLeagues, TTL.LEAGUES);

    console.log(
      `[syncLeagues] metadata refresh done – created=${upserted}, updated=${updated}, total=${allLeagues.length}`,
    );
  } catch (err) {
    console.error("[syncLeagues] error:", err);
  }
}
