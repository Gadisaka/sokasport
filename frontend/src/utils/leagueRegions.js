/**
 * Categorizes leagues into regions for the sidebar.
 * - International: World Cup, Friendlies, multi-continental qualifiers
 * - Europe: UEFA club/national competitions
 * - Asia: AFC competitions
 * - America: CONMEBOL + CONCACAF competitions
 * - Africa: CAF competitions
 * - Countries: Domestic leagues grouped by country
 */

const INTERNATIONAL_PATTERNS = [
  /world cup(?! - qual)/i,
  /^friendlies$/i,
  /^international$/i,
];

const EUROPE_PATTERNS = [
  /champions league/i,
  /europa league/i,
  /conference league/i,
  /euro championship/i,
  /euros? 20\d{2}/i,
  /nations league/i,
  /uefa super cup/i,
  /world cup - qualification europe/i,
];

const ASIA_PATTERNS = [
  /afc champions/i,
  /asian cup/i,
  /afc cup/i,
  /world cup - qualification asia/i,
  /a-league/i,
];

const AMERICA_PATTERNS = [
  /copa libertadores/i,
  /copa sudamericana/i,
  /conmebol sudamericana/i,
  /copa america/i,
  /concacaf/i,
  /gold cup/i,
  /world cup - qualification (south america|concacaf)/i,
];

const AFRICA_PATTERNS = [
  /africa cup of nations/i,
  /afcon/i,
  /caf champions/i,
  /caf confederation/i,
  /caf super cup/i,
  /world cup - qualification africa/i,
];

function matchesAny(text, patterns) {
  return patterns.some((p) => p.test(text));
}

export function getLeagueRegion(leagueKey) {
  const str = String(leagueKey || "");
  const sep = str.indexOf(" - ");
  const country = sep === -1 ? "" : str.slice(0, sep);
  const name = sep === -1 ? str : str.slice(sep + 3);
  const full = `${country} ${name}`.trim();

  if (matchesAny(full, INTERNATIONAL_PATTERNS)) return "international";
  if (matchesAny(full, EUROPE_PATTERNS)) return "europe";
  if (matchesAny(full, ASIA_PATTERNS)) return "asia";
  if (matchesAny(full, AMERICA_PATTERNS)) return "america";
  if (matchesAny(full, AFRICA_PATTERNS)) return "africa";

  return "country";
}

export const REGION_ORDER = ["international", "europe", "asia", "america", "africa"];

export const REGION_LABELS = {
  international: "International",
  europe: "Europe",
  asia: "Asia",
  america: "America",
  africa: "Africa",
};

export const REGION_ICONS = {
  international: "globe",
  europe: "flag",
  asia: "flag",
  america: "flag",
  africa: "flag",
};
