/**
 * Canonical Ethiopian phone-number helpers.
 *
 * The app accepts phones in several user-typed formats — local `09xxxxxxxx` /
 * `07xxxxxxxx`, international `+2519xxxxxxxx` / `+2517xxxxxxxx`, or bare
 * `9xxxxxxxx` — that all refer to the same subscriber. Normalizing to a single
 * digit form (`2519xxxxxxxx`) before storing or looking up a phone lets the
 * `User.phone @unique` constraint correctly treat those formats as one account.
 */

/**
 * Collapse any accepted Ethiopian phone format to canonical digits `251XXXXXXXXX`.
 * Strips all non-digits, converts a leading `0` to the `251` country code, and
 * prefixes `251` to a bare 9-digit national number.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeEthiopiaPhone(input) {
  let d = String(input ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = `251${d.slice(1)}`;
  if (d.length === 9) d = `251${d}`;
  return d;
}

/**
 * Like {@link normalizeEthiopiaPhone} but returns `null` for empty/blank input,
 * for optional-phone flows where an absent phone must stay `null` rather than
 * becoming an empty string.
 *
 * @param {unknown} input
 * @returns {string|null}
 */
export function normalizePhoneOrNull(input) {
  const normalized = normalizeEthiopiaPhone(input);
  return normalized ? normalized : null;
}
