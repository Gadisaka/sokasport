function formatDateForUi(isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";

  const datePart = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
  });
  const timePart = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart} ${d.getFullYear()}`;
}

function toUiOdd(value) {
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) return null;
  return n.toFixed(2);
}

function normalizeSelectionLabel(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (["home", "1"].includes(raw)) return "1";
  if (["draw", "x"].includes(raw)) return "x";
  if (["away", "2"].includes(raw)) return "2";
  if (["1x", "home/draw", "home or draw"].includes(raw)) return "1x";
  if (["12", "home/away", "home or away"].includes(raw)) return "12";
  if (["x2", "draw/away", "draw or away"].includes(raw)) return "x2";
  // For non-1X2/DC markets (Over/Under, Asian Handicap, Correct Score, …),
  // keep the upstream label verbatim so the UI can display it as-is.
  return String(value || "").trim();
}

function toCategoryOdds(lines = []) {
  const seen = new Set();
  const out = [];

  for (const line of lines) {
    const id = normalizeSelectionLabel(line.value);
    const value = toUiOdd(line.odd);
    if (!value || !id) continue;
    // Multiple bookmakers may price the same value for the same market.
    // When no preferred bookmaker is set server-side the line list can be
    // huge — dedupe by label so the UI doesn't render stacks of the same
    // button.
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, value });
  }

  return out;
}

// Categories we consider "main" — they feed the compact summary row
// (1 / X / 2 / 1X / X2 / 12) shown on every match card.
const MAIN_MARKET_NAMES = new Set(["Match Winner", "Double Chance"]);

function toDetailedOdds(markets = []) {
  const normalized = markets
    .map((market) => ({
      category: market.name,
      odds: toCategoryOdds(market.odd_lines),
    }))
    .filter((m) => m.odds.length > 0);

  const main = normalized.filter((m) => MAIN_MARKET_NAMES.has(m.category));
  const extra = normalized.filter((m) => !MAIN_MARKET_NAMES.has(m.category));
  return { main, extra };
}

/**
 * Raw fixtures may arrive as either:
 * - **Summary lists** (`GET /fixtures?date=`): Match Winner + Double Chance only,
 *   capped odd_lines — enough for the collapsed row (`markets`, compact `detailedOdds.main`).
 * - **Detail** (`GET /odds/:id`): merged via `applyOddsToMatch` into `detailedOdds` /
 *   `sideBets` only; the six-cell `markets` strip stays from the list payload so
 *   prices do not jump when the row expands.
 *
 * `toSummaryMarkets` builds the compact strip using `toCategoryOdds` per market
 * (first priced line wins per selection label).
 */
function toSummaryMarkets(markets = []) {
  const map = {};

  for (const market of markets) {
    const name = String(market.name || "").toLowerCase();
    if (!name.includes("match winner") && !name.includes("double chance"))
      continue;

    const lines = toCategoryOdds(market.odd_lines || []);

    for (const { id, value } of lines) {
      const key = String(id).toLowerCase();
      if (name.includes("match winner") && ["1", "x", "2"].includes(key)) {
        map[key] = value;
      }
      if (name.includes("double chance") && ["1x", "12", "x2"].includes(key)) {
        map[key] = value;
      }
    }
  }

  return ["1", "x", "2", "1x", "x2", "12"].map((id) => ({
    id,
    value: map[id] || null,
  }));
}

function leagueSportName(league) {
  const s = league?.sport;
  if (s && typeof s === "object") return s.name || s.slug || "Football";
  if (typeof s === "string") return s;
  return "Football";
}

export function mapFixtureToMatch(fixture, oddsPayload = null) {
  const home = fixture?.home_team?.name || "Home";
  const away = fixture?.away_team?.name || "Away";
  const leagueName = fixture?.league?.name || "Unknown League";
  const country = fixture?.league?.country || "Unknown";
  const countryFlag = fixture?.league?.country_flag || null;
  const leagueLogo = fixture?.league?.logo || null;
  const homeTeamLogo = fixture?.home_team?.logo || null;
  const awayTeamLogo = fixture?.away_team?.logo || null;
  const rawSportName =
    fixture?.sport?.name ||
    fixture?.sport_name ||
    leagueSportName(fixture?.league) ||
    "Football";
  const sportName = String(rawSportName || "Football");
  const sportId = sportName.trim().toLowerCase().replace(/\s+/g, "-");

  const markets = oddsPayload?.markets || fixture?.markets || [];
  const detailedOdds = toDetailedOdds(markets);

  // "sideBets" is the badge on the row — it's the number of non-main markets
  // that actually have priced odds. Using normalized length keeps it honest
  // even when the upstream returned an empty market (which we filter out).
  // List responses may omit full markets but set `extra_markets_count` from DB.
  const rawExtraCount = fixture?.extra_markets_count;
  const sideBets = Number.isFinite(rawExtraCount)
    ? rawExtraCount
    : detailedOdds.extra.length;

  const kickoffAt = fixture?.start_time
    ? new Date(fixture.start_time).toISOString()
    : null;

  return {
    id: `fx-${fixture.api_fixture_id}`,
    apiFixtureId: fixture.api_fixture_id,
    league: `${country} - ${leagueName}`,
    match: `${home} V ${away}`,
    date: formatDateForUi(fixture.start_time),
    kickoffAt,
    sportId,
    sportName,
    status: fixture.status,
    homeScore: fixture.home_score,
    awayScore: fixture.away_score,
    countryFlag,
    leagueLogo,
    homeTeamLogo,
    awayTeamLogo,
    markets: toSummaryMarkets(markets),
    sideBets,
    detailedOdds,
  };
}

/**
 * Merges `/odds/:id` into a list-row match. Keeps `match.markets` (1–X–2 + DC)
 * from the original list response so opening the panel does not retint those
 * cells; `detailedOdds` and `sideBets` reflect the full detail payload.
 */
export function applyOddsToMatch(match, oddsPayload) {
  if (!match || !oddsPayload) return match;
  const leagueStr = String(match.league || "");
  const sep = leagueStr.indexOf(" - ");
  const country = sep === -1 ? "Unknown" : leagueStr.slice(0, sep);
  const name = sep === -1 ? leagueStr || "League" : leagueStr.slice(sep + 3);
  const [homeName = "Home", awayName = "Away"] = String(
    match.match || "",
  ).split(" V ");

  const kickoffIso = match.kickoffAt || null;

  const hydrated = mapFixtureToMatch(
    {
      api_fixture_id: match.apiFixtureId,
      start_time: kickoffIso || new Date().toISOString(),
      status: match.status,
      home_score: match.homeScore,
      away_score: match.awayScore,
      home_team: { name: homeName, logo: match.homeTeamLogo },
      away_team: { name: awayName, logo: match.awayTeamLogo },
      league: {
        name,
        country,
        country_flag: match.countryFlag,
        logo: match.leagueLogo,
        sport: match.sportName || "Football",
      },
      markets: oddsPayload.markets,
    },
    oddsPayload,
  );

  return {
    ...match,
    markets: match.markets,
    sideBets: hydrated.sideBets,
    detailedOdds: hydrated.detailedOdds,
    countryFlag: hydrated.countryFlag ?? match.countryFlag,
    leagueLogo: hydrated.leagueLogo ?? match.leagueLogo,
    homeTeamLogo: hydrated.homeTeamLogo ?? match.homeTeamLogo,
    awayTeamLogo: hydrated.awayTeamLogo ?? match.awayTeamLogo,
  };
}
