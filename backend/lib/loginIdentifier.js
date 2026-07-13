/**
 * Login identifier resolution — staff use username, players use phone.
 */

import { normalizeEthiopiaPhone } from "./phone.js";
import { normalizeUsername } from "./username.js";

/**
 * Parse login body into a single lookup mode.
 *
 * @param {{ username?: unknown, phone?: unknown }} body
 * @returns
 *   | { ok: true, mode: "username", username: string }
 *   | { ok: true, mode: "phone", phone: string }
 *   | { ok: false, message: string }
 */
export function resolveLoginIdentifier(body = {}) {
  const { username, phone } = body;
  const hasPhone = Boolean(phone && String(phone).trim());
  const hasUsername = Boolean(username && String(username).trim());

  if ((!hasPhone && !hasUsername) || (hasPhone && hasUsername)) {
    return {
      ok: false,
      message:
        "Provide exactly one of username (staff) or phone (player), plus password",
    };
  }

  if (hasUsername) {
    const normalized = normalizeUsername(username);
    if (!normalized) {
      return { ok: false, message: "Username is required" };
    }
    return { ok: true, mode: "username", username: normalized };
  }

  return {
    ok: true,
    mode: "phone",
    phone: normalizeEthiopiaPhone(phone),
  };
}

/**
 * Whether the resolved identifier mode is allowed for the user's role.
 * Staff must use username; players must use phone.
 *
 * @param {"username"|"phone"} mode
 * @param {string} roleName
 * @returns {boolean}
 */
export function isLoginPathAllowed(mode, roleName) {
  if (mode === "username") return roleName !== "PLAYER";
  return roleName === "PLAYER";
}
