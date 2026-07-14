/**
 * Sync the InOut game catalog into the `InoutGame` collection.
 *
 * Fetches the provider's gameModesList for our operator and upserts each game
 * by `game_mode`. Provider-owned fields (title/description/icon/rtp/multiplayer)
 * are refreshed on every run; the admin-owned `enabled` and `sort_order` are
 * only set when a row is first created so curation survives re-syncs.
 *
 * Games removed on the provider side are left in place (not deleted) so history
 * and any admin ordering are preserved; admins can disable them manually.
 *
 * @module jobs/syncInoutCatalog
 */
import { prisma } from "../Config/db.js";
import { getInoutOperatorId } from "../Config/inout.js";
import { fetchGameModesList } from "../services/inoutApiService.js";
import { deleteCache } from "../services/cacheService.js";
import { INOUT_GAMES_CACHE_KEY } from "../lib/inoutCatalogCache.js";

/**
 * @returns {Promise<{ total: number, created: number, updated: number }>}
 */
export default async function syncInoutCatalog() {
  const operatorId = getInoutOperatorId();
  const games = await fetchGameModesList(operatorId);

  let created = 0;
  let updated = 0;

  for (const g of games) {
    const gameMode = g?.gameMode;
    if (!gameMode) continue;

    const providerFields = {
      title: g.title ?? gameMode,
      description: g.description ?? null,
      icon_url: g.iconsUrls?.url ?? null,
      multiplayer: Boolean(g.multiplayer),
      rtp: g.rtp != null ? String(g.rtp) : null,
      raw: g,
    };

    const existing = await prisma.inoutGame.findUnique({
      where: { game_mode: gameMode },
      select: { id: true },
    });

    if (existing) {
      await prisma.inoutGame.update({
        where: { game_mode: gameMode },
        data: providerFields,
      });
      updated++;
    } else {
      await prisma.inoutGame.create({
        data: { game_mode: gameMode, ...providerFields },
      });
      created++;
    }
  }

  await deleteCache(INOUT_GAMES_CACHE_KEY);

  const result = { total: games.length, created, updated };
  console.log(
    `[syncInoutCatalog] operator=${operatorId} total=${result.total} created=${created} updated=${updated}`,
  );
  return result;
}
