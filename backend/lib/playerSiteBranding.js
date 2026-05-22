/**
 * Player site navbar + loading logos (CMS) — JSON in `Setting.value`.
 *
 * @module lib/playerSiteBranding
 */
import { MAX_HERO_BANNER_URL_LENGTH } from "./homeHeroBanners.js";

/** DB row key for Prisma `Setting` — JSON object of optional https image URLs. */
export const PLAYER_SITE_BRANDING_SETTING_KEY = "PLAYER_SITE_BRANDING";

/** @typedef {{ navbarWide?: string, navbarCompact?: string, loadingLogo?: string }} PlayerSiteBranding */

const URL_FIELDS = ["navbarWide", "navbarCompact", "loadingLogo"];

/**
 * @param {string | undefined} raw
 * @returns {PlayerSiteBranding}
 */
export function parsePlayerSiteBrandingValue(raw) {
  if (raw == null || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    /** @type {PlayerSiteBranding} */
    const out = {};
    for (const key of URL_FIELDS) {
      const v = parsed[key];
      if (typeof v === "string" && v.trim()) out[key] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {string} trimmed
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function validateOptionalHttpsUrl(trimmed) {
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
  return { ok: true };
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, branding: PlayerSiteBranding } | { ok: false, message: string }}
 */
export function validatePlayerSiteBrandingPayload(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Body must be an object" };
  }
  /** @type {PlayerSiteBranding} */
  const branding = {};
  for (const key of URL_FIELDS) {
    const raw = /** @type {Record<string, unknown>} */ (body)[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") {
      return { ok: false, message: `${key} must be a string or omitted` };
    }
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    const v = validateOptionalHttpsUrl(trimmed);
    if (!v.ok) return { ...v, message: `${key}: ${v.message}` };
    branding[key] = trimmed;
  }
  return { ok: true, branding };
}
