/**
 * Thin helper around the generic `settings` key-value table for settings
 * that need to be read on every public API request (currently only the
 * preferred-bookmaker selection). Results are cached in Redis cache for 60s so
 * /fixtures/today and /odds/:id don't hit Postgres/Mongo on every hit.
 */
import { prisma } from "../Config/db.js";
import {
  deleteByPattern,
  deleteCache,
  getCache,
  setCache,
} from "./cacheService.js";

export const PREFERRED_BOOKMAKER_SETTING_KEY = "PREFERRED_BOOKMAKER_API_ID";
const PREFERRED_BOOKMAKER_CACHE_KEY = "settings:preferred_bookmaker";
const PREFERRED_BOOKMAKER_CACHE_TTL = 60;

function parseStoredBookmakerId(raw) {
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve the current preferred bookmaker as its stable API-Sports id
 * (e.g. 8 = Bet365). Returns `null` when no preference is set, in which
 * case callers should expose odds from every bookmaker.
 */
export async function getPreferredBookmakerApiId() {
  const cached = await getCache(PREFERRED_BOOKMAKER_CACHE_KEY);
  if (cached !== null && cached !== undefined) {
    if (cached === "null") return null;
    const n = Number.parseInt(cached, 10);
    return Number.isFinite(n) ? n : null;
  }

  const row = await prisma.setting.findUnique({
    where: { key: PREFERRED_BOOKMAKER_SETTING_KEY },
  });
  const id = parseStoredBookmakerId(row?.value);

  await setCache(
    PREFERRED_BOOKMAKER_CACHE_KEY,
    id === null ? "null" : String(id),
    PREFERRED_BOOKMAKER_CACHE_TTL,
  );
  return id;
}

/**
 * Resolve the internal Prisma bookmaker row for the preferred api id.
 * Returns `null` when unset OR when the bookmaker has not yet been seen
 * (we can't filter odds by an unknown bookmaker — fall back to "all").
 */
export async function getPreferredBookmakerRecord() {
  const apiId = await getPreferredBookmakerApiId();
  if (apiId == null) return null;
  return prisma.bookmaker.findUnique({
    where: { api_bookmaker_id: apiId },
  });
}

/**
 * Persist a new preferred bookmaker. Pass `null` to clear the preference
 * (i.e. show odds from every bookmaker to end-users).
 *
 * After writing, we:
 *   1. bust the 60s preference cache (so the next request sees the new value)
 *   2. bust fixtures:today / upcoming / live (they embed bookmaker-filtered odds)
 *   3. bust every odds:fixture:* entry (per-fixture cached odds are also filtered)
 */
export async function setPreferredBookmakerApiId(apiId) {
  if (apiId == null) {
    await prisma.setting.deleteMany({
      where: { key: PREFERRED_BOOKMAKER_SETTING_KEY },
    });
  } else {
    await prisma.setting.upsert({
      where: { key: PREFERRED_BOOKMAKER_SETTING_KEY },
      create: {
        key: PREFERRED_BOOKMAKER_SETTING_KEY,
        value: String(apiId),
      },
      update: { value: String(apiId) },
    });
  }

  await deleteCache(PREFERRED_BOOKMAKER_CACHE_KEY);
  await deleteByPattern("fixtures:today:*");
  await deleteByPattern("fixtures:by-date:*");
  await deleteByPattern("fixtures:upcoming:*");
  await deleteByPattern("live:fixtures:*");
  await deleteByPattern("odds:fixture:*");

  return apiId ?? null;
}
