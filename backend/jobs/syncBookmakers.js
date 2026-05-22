import prisma from "../Config/db.js";
import { api } from "../services/apiSportsService.js";

/**
 * One-shot bookmaker catalog sync.
 *
 * Pulls the full list from API-Sports `GET /odds/bookmakers` and upserts
 * into the local `bookmaker` table. The upstream list is essentially
 * static, so:
 *   - Bootstrap seeds it once when the table is empty so the admin UI
 *     can offer the full picker even before any odds have been ingested.
 *   - Admins can also trigger a manual refresh from the API Configuration
 *     page (POST /admin/api-config/sync-bookmakers).
 *
 * Skip-if-unchanged: we only call `update` when the upstream `name`
 * actually differs, matching the same write-amplification guard used in
 * the fixture/team sync paths.
 */
export default async function syncBookmakers({ force = false } = {}) {
  const sport = "football";
  const rawList = await api(sport).getBookmakers(
    force ? { skipCache: true } : undefined,
  );

  if (!Array.isArray(rawList) || rawList.length === 0) {
    console.warn("[syncBookmakers] upstream returned no bookmakers");
    return { fetched: 0, created: 0, updated: 0, skipped: 0 };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const bk of rawList) {
    const apiBookmakerId = Number(bk?.id);
    const name = typeof bk?.name === "string" ? bk.name.trim() : "";

    // API-Sports occasionally returns entries with `name: null` (e.g. id=37).
    // Persisting them would surface a blank row in the admin picker, so we
    // skip them outright. The schema requires `name: String` anyway.
    if (!Number.isFinite(apiBookmakerId) || !name) {
      skipped++;
      continue;
    }

    const existing = await prisma.bookmaker.findUnique({
      where: { api_bookmaker_id: apiBookmakerId },
    });

    if (existing) {
      if (existing.name === name) {
        skipped++;
        continue;
      }
      await prisma.bookmaker.update({
        where: { api_bookmaker_id: apiBookmakerId },
        data: { name },
      });
      updated++;
      continue;
    }

    try {
      await prisma.bookmaker.create({
        data: { api_bookmaker_id: apiBookmakerId, name },
      });
      created++;
    } catch (err) {
      // Concurrent insert race – fall back to update so we still converge.
      if (err?.code !== "P2002") throw err;
      await prisma.bookmaker.update({
        where: { api_bookmaker_id: apiBookmakerId },
        data: { name },
      });
      updated++;
    }
  }

  console.log(
    `[syncBookmakers] done – fetched=${rawList.length}, created=${created}, updated=${updated}, skipped=${skipped}`,
  );

  return { fetched: rawList.length, created, updated, skipped };
}
