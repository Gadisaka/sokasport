/**
 * Language normalization for InOut launch URLs.
 *
 * InOut supports a fixed set of language codes; anything else falls back to
 * English on their side. Our UI languages are `en` and `am` (Amharic), and
 * Amharic is unsupported by InOut, so it maps to `en`.
 *
 * @module lib/inoutLang
 */

const SUPPORTED = new Set([
  "az", "bn", "bd", "en", "es", "hi", "id", "kk", "kz",
  "mx", "ch", "pe", "ec", "co", "pt", "br", "ru", "tr",
  "uk", "ua", "uz", "zh",
]);

/**
 * @param {unknown} lang
 * @returns {string} A supported InOut language code (defaults to "en").
 */
export function normalizeLang(lang) {
  const l = String(lang || "").toLowerCase();
  return SUPPORTED.has(l) ? l : "en";
}
