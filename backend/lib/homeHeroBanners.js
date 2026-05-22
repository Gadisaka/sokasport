/** DB row key for Prisma `Setting` — JSON array of image URLs (https). */
export const HOME_HERO_BANNERS_SETTING_KEY = "HOME_HERO_BANNERS";

export const MAX_HOME_HERO_BANNERS = 5;

export const MAX_HERO_BANNER_URL_LENGTH = 2048;

export function parseHomeHeroBannersValue(raw) {
  if (raw == null || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((u) => typeof u === "string");
  } catch {
    return [];
  }
}

/**
 * @param {unknown} urls
 * @returns {{ ok: true, urls: string[] } | { ok: false, message: string }}
 */
export function validateHeroBannerUrls(urls) {
  if (!Array.isArray(urls)) {
    return { ok: false, message: "urls must be an array" };
  }
  if (urls.length > MAX_HOME_HERO_BANNERS) {
    return {
      ok: false,
      message: `At most ${MAX_HOME_HERO_BANNERS} banner images allowed`,
    };
  }
  const normalized = [];
  for (const u of urls) {
    if (typeof u !== "string" || !String(u).trim()) {
      return { ok: false, message: "Each url must be a non-empty string" };
    }
    const trimmed = String(u).trim();
    if (trimmed.length > MAX_HERO_BANNER_URL_LENGTH) {
      return { ok: false, message: "Url too long" };
    }
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { ok: false, message: "Invalid url" };
    }
    if (parsed.protocol !== "https:") {
      return { ok: false, message: "Urls must use https" };
    }
    normalized.push(trimmed);
  }
  return { ok: true, urls: normalized };
}
