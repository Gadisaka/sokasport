/**
 * Staff username helpers.
 *
 * Usernames are staff-only login identifiers: lowercase `[a-z0-9_]`, length 3–32.
 * Players must omit `username` (field absent, not null) and log in with phone.
 * Writing `username: null` breaks the Mongo sparse unique index on username.
 */

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

/**
 * Normalize a username candidate: trim, lowercase, strip invalid chars.
 * Returns empty string when nothing usable remains.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeUsername(input) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Validate a username (after normalization). Returns `{ ok: true, username }`
 * or `{ ok: false, message }`.
 *
 * @param {unknown} input
 * @returns {{ ok: true, username: string } | { ok: false, message: string }}
 */
export function validateUsername(input) {
  const username = normalizeUsername(input);
  if (!username) {
    return { ok: false, message: "Username is required" };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      message:
        "Username must be 3–32 characters: lowercase letters, numbers, underscore only",
    };
  }
  return { ok: true, username };
}

/**
 * Build a unique staff username candidate from email / phone / user id.
 * Caller must still check uniqueness and append suffixes if needed.
 *
 * @param {{ email?: string|null, phone?: string|null, id?: string|null }} user
 * @returns {string}
 */
export function suggestUsernameFromUser(user) {
  const emailLocal = String(user?.email ?? "")
    .split("@")[0]
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  if (emailLocal && emailLocal.length >= 3) {
    return emailLocal.slice(0, 32);
  }

  const phoneDigits = String(user?.phone ?? "").replace(/\D/g, "");
  if (phoneDigits.length >= 3) {
    const base = phoneDigits.slice(-8);
    return (base.length >= 3 ? base : `u_${base}`).slice(0, 32);
  }

  const idSlice = String(user?.id ?? "user")
    .replace(/[^a-z0-9_]/gi, "")
    .toLowerCase()
    .slice(0, 8);
  return `user_${idSlice || "x"}`.slice(0, 32);
}
