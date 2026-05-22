import prisma from "../Config/db.js";
import { upsertNoTx } from "../utils/upsertNoTx.js";
import { api, sleep } from "../services/apiSportsService.js";
import { deleteCache } from "../services/cacheService.js";
import { getEnabledSports } from "../services/sportsRegistry.js";

/**
 * @deprecated
 *
 * Teams are now upserted inline by the bulk-by-date fixtures ingestion
 * (`runFixturesBulkByDate`). This job is no longer registered on any
 * scheduler – it remains as a one-shot backfill helper for the rare case
 * where you need to re-hydrate the `teams` collection from the upstream
 * `/teams?league=…&season=…` endpoint (e.g. logos changed).
 *
 * Run manually with: `node -e "import('./jobs/syncTeams.js').then(m => m.default())"`
 *
 * The previous Redis lock has been removed. Concurrency was the queue's
 * job; for a manual backfill there's nothing to serialize against.
 */

const API_CALL_DELAY_MS = 6500;

export default async function syncTeamsBackfill() {
  console.warn(
    "[syncTeams] DEPRECATED – running manual backfill. Teams are now created inline by syncFixtures.",
  );

  try {
    const enabled = getEnabledSports();
    if (!enabled.length) {
      console.warn("[syncTeams] no enabled sports – nothing to do");
      return;
    }

    const leagues = await prisma.league.findMany({
      where: { active: true, sport: { slug: { in: enabled } } },
      include: { sport: true },
    });
    console.log(`[syncTeams] active leagues to process: ${leagues.length}`);

    let total = 0;
    let processedLeagues = 0;

    for (const league of leagues) {
      if (league.api_league_id == null) continue;

      const sportSlug = league.sport?.slug;
      if (!sportSlug) continue;
      processedLeagues++;

      const season = league.season ?? new Date().getFullYear() - 1;
      console.log(
        `[syncTeams] league ${processedLeagues}/${leagues.length} – ${league.name} (${sportSlug}), season=${season}`,
      );
      const apiTeams = await api(sportSlug).getTeams(
        league.api_league_id,
        season,
      );
      console.log(
        `[syncTeams] ${league.name}: upstream teams=${apiTeams.length}`,
      );

      let leagueUpserts = 0;

      for (const entry of apiTeams) {
        const t = entry.team ?? entry;
        if (!t?.id) continue;

        await upsertNoTx(prisma.team, {
          where: { api_team_id: t.id },
          update: {
            name: t.name,
            logo: t.logo ?? null,
            league_id: league.id,
          },
          create: {
            api_team_id: t.id,
            name: t.name,
            logo: t.logo ?? null,
            league_id: league.id,
          },
        });
        total++;
        leagueUpserts++;
      }

      await deleteCache(`teams:league:${league.api_league_id}`);
      console.log(
        `[syncTeams] ${league.name}: upserted ${leagueUpserts} teams (running total=${total})`,
      );
      await sleep(API_CALL_DELAY_MS);
    }

    console.log(`[syncTeams] backfill done – ${total} teams upserted`);
  } catch (err) {
    console.error("[syncTeams] error:", err);
  }
}
