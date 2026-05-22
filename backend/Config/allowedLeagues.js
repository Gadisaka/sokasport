/**
 * Allowlist of API-Football league IDs that we ingest fixtures and odds for.
 * IDs sourced from LIST_OF_LEAGUES.md (verified against API-Football /v3/leagues).
 *
 * Only fixtures belonging to these leagues will be stored in the database.
 * This dramatically reduces API usage, DB size, and sync times.
 */

export const ALLOWED_LEAGUE_IDS = new Set([
  // ─────────────────────────────────────────────────────────────────────────
  // EUROPE (TOP 5)
  // ─────────────────────────────────────────────────────────────────────────
  39, // English Premier League
  140, // La Liga (Spain)
  135, // Serie A (Italy)
  78, // Bundesliga (Germany)
  61, // Ligue 1 (France)

  // ─────────────────────────────────────────────────────────────────────────
  // UEFA COMPETITIONS
  // ─────────────────────────────────────────────────────────────────────────
  2, // UEFA Champions League
  3, // UEFA Europa League
  848, // UEFA Europa Conference League

  // ─────────────────────────────────────────────────────────────────────────
  // EUROPE (OTHER TOP LEAGUES)
  // ─────────────────────────────────────────────────────────────────────────
  94, // Primeira Liga (Portugal)
  88, // Eredivisie (Netherlands)
  144, // Belgian Pro League (Jupiler Pro League)
  203, // Turkish Süper Lig
  179, // Scottish Premiership
  235, // Russia Premier League
  333, // Ukraine Premier League
  383, // Israel Premier League (Ligat Ha'al)

  // ─────────────────────────────────────────────────────────────────────────
  // EUROPE (DOMESTIC CUPS)
  // ─────────────────────────────────────────────────────────────────────────
  45, // FA Cup (England)
  48, // EFL Cup / Carabao Cup (England)
  143, // Copa del Rey (Spain)
  137, // Coppa Italia (Italy)
  81, // DFB-Pokal (Germany)
  66, // Coupe de France (France)

  // ─────────────────────────────────────────────────────────────────────────
  // AMERICAS
  // ─────────────────────────────────────────────────────────────────────────
  253, // Major League Soccer (USA)
  262, // Liga MX (Mexico)
  128, // Argentine Primera División (Liga Profesional Argentina)
  71, // Campeonato Brasileiro Série A

  // ─────────────────────────────────────────────────────────────────────────
  // ASIA / MIDDLE EAST
  // ─────────────────────────────────────────────────────────────────────────
  307, // Saudi Pro League
  98, // J1 League (Japan)
  169, // Chinese Super League
  504, // King Cup (Saudi Arabia)

  // ─────────────────────────────────────────────────────────────────────────
  // AFRICA
  // ─────────────────────────────────────────────────────────────────────────
  363, // Ethiopian Premier League
  233, // Egyptian Premier League
  288, // South African Premier Division (Premier Soccer League)
  186, // Algeria Ligue 1

  // ─────────────────────────────────────────────────────────────────────────
  // EUROPE (LOWER DIVISIONS)
  // ─────────────────────────────────────────────────────────────────────────
  40, // EFL Championship (England)
  41, // League One (England)
  42, // League Two (England)
  136, // Serie B (Italy)
  79, // 2. Bundesliga (Germany)
  141, // Segunda División (Spain)

  // ─────────────────────────────────────────────────────────────────────────
  // SCANDINAVIA
  // ─────────────────────────────────────────────────────────────────────────
  113, // Allsvenskan (Sweden)
  103, // Eliteserien (Norway)
  119, // Danish Superliga

  // ─────────────────────────────────────────────────────────────────────────
  // EASTERN EUROPE
  // ─────────────────────────────────────────────────────────────────────────
  106, // Ekstraklasa (Poland)
  345, // Czech First League (Czech Liga)
  210, // Croatian First Football League (HNL)
  197, // Greek Super League 1

  // ─────────────────────────────────────────────────────────────────────────
  // OTHERS
  // ─────────────────────────────────────────────────────────────────────────
  323, // Indian Super League
  188, // A-League (Australia)
  305, // Qatar Stars League
  301, // UAE Pro League
  292, // South Korean K League 1

  // ─────────────────────────────────────────────────────────────────────────
  // INTERNATIONAL (NATIONAL TEAMS)
  // ─────────────────────────────────────────────────────────────────────────
  1, // FIFA World Cup
  29, // World Cup Qualification – Africa
  30, // World Cup Qualification – Asia
  31, // World Cup Qualification – CONCACAF
  32, // World Cup Qualification – Europe
  33, // World Cup Qualification – Oceania
  34, // World Cup Qualification – South America
  37, // World Cup Qualification – Intercontinental Play-offs
  4, // UEFA European Championship (EURO)
  6, // Africa Cup of Nations (AFCON)
  9, // Copa América
  7, // AFC Asian Cup
  22, // CONCACAF Gold Cup
  5, // UEFA Nations League

  // ─────────────────────────────────────────────────────────────────────────
  // CONTINENTAL CLUB COMPETITIONS
  // ─────────────────────────────────────────────────────────────────────────
  13, // Copa Libertadores (CONMEBOL Libertadores)
  11, // Copa Sudamericana (CONMEBOL Sudamericana)
  12, // CAF Champions League
  20, // CAF Confederation Cup
  17, // AFC Champions League Elite
  18, // AFC Champions League Two

  // ─────────────────────────────────────────────────────────────────────────
  // FRIENDLIES
  // ─────────────────────────────────────────────────────────────────────────
  10, // International Friendlies (National Teams)
  667, // Club Friendly Matches

  // ─────────────────────────────────────────────────────────────────────────
  // WOMEN'S FOOTBALL
  // ─────────────────────────────────────────────────────────────────────────
  8, // FIFA Women's World Cup
  743, // UEFA Women's EURO (UEFA Championship - Women)
  922, // Women's Africa Cup of Nations
  525, // UEFA Women's Champions League
]);

/**
 * Always listed in the sportsbook sidebar (even with 0 fixtures in the client slice).
 * Subset of ALLOWED_LEAGUE_IDS — top domestic + flagship UEFA club competitions.
 */
export const PREFERRED_LEAGUE_IDS = new Set([
  2, // UEFA Champions League
  39, // English Premier League
  140, // La Liga (Spain)
  135, // Serie A (Italy)
  78, // Bundesliga (Germany)
  61, // Ligue 1 (France)
  3, // UEFA Europa League
  848, // UEFA Europa Conference League
]);

/**
 * Quick membership check for filtering fixtures during ingestion.
 * @param {number} leagueId API-Football league.id
 */
export function isAllowedLeague(leagueId) {
  return ALLOWED_LEAGUE_IDS.has(leagueId);
}

export { getLeagueTier } from "./leagueTiers.js";
