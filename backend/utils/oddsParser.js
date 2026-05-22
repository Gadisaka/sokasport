/**
 * Accepts the raw `response` array returned by GET /odds (API-Sports),
 * and normalises it into the shape our DB/cache layer understands.
 */

const EXCLUDED_MARKET_NAMES = new Set([]);

function isValidMarketName(name) {
  if (!name) return false;
  if (EXCLUDED_MARKET_NAMES.has(name)) return false;
  return true;
}

/**
 * @param {object} bk - raw API-Sports bookmaker object
 * @param {Set<string>|null} allowedMarketNames
 */
function mapBookmakerMarkets(bk, allowedMarketNames) {
  return (bk.bets ?? [])
    .filter((bet) => isValidMarketName(bet?.name))
    .filter(
      (bet) =>
        allowedMarketNames === null ||
        allowedMarketNames.has(String(bet.name)),
    )
    .map((bet) => ({
      name: String(bet.name),
      values: (bet.values ?? [])
        .map((v) => ({
          value: String(v.value ?? "").trim(),
          odd: Number.parseFloat(v.odd),
        }))
        .filter(
          (v) =>
            v.value.length > 0 && Number.isFinite(v.odd) && v.odd > 0,
        ),
    }))
    .filter((m) => m.values.length > 0);
}

/**
 * @param {Array} apiOddsResponse
 * @param {object} [options]
 * @param {number[]|null} [options.orderedBookmakerApiIds]
 *   When non-empty, walk this list and return **only** the first bookmaker
 *   that survives market filtering (single-bookmaker MVP writes).
 * @param {Set<number>|null} [options.allowedBookmakerApiIds]
 *   Legacy “subset” filter when orderedBookmakerApiIds is absent.
 * @param {Set<string>|null} [options.allowedMarketNames]
 */
export function parseMarkets(apiOddsResponse, options = {}) {
  if (!Array.isArray(apiOddsResponse) || apiOddsResponse.length === 0) {
    return { bookmakers: [] };
  }

  const orderedBookmakerApiIds =
    Array.isArray(options.orderedBookmakerApiIds) &&
    options.orderedBookmakerApiIds.length > 0
      ? options.orderedBookmakerApiIds
      : null;

  const allowedBookmakerApiIds =
    options.allowedBookmakerApiIds instanceof Set
      ? options.allowedBookmakerApiIds
      : null;

  const allowedMarketNames =
    options.allowedMarketNames instanceof Set
      ? options.allowedMarketNames
      : null;

  const entry = apiOddsResponse[0];
  const bookmakers = entry.bookmakers ?? [];

  if (orderedBookmakerApiIds) {
    for (const bkId of orderedBookmakerApiIds) {
      const bk = bookmakers.find((b) => Number(b.id) === Number(bkId));
      if (!bk) continue;
      const markets = mapBookmakerMarkets(bk, allowedMarketNames);
      if (markets.length > 0) {
        return {
          fixtureId: entry.fixture?.id,
          bookmakers: [
            {
              apiBookmakerId: bk.id,
              name: bk.name,
              markets,
            },
          ],
        };
      }
    }
    return { fixtureId: entry.fixture?.id, bookmakers: [] };
  }

  return {
    fixtureId: entry.fixture?.id,
    bookmakers: bookmakers
      .filter(
        (bk) =>
          allowedBookmakerApiIds === null ||
          allowedBookmakerApiIds.has(bk.id),
      )
      .map((bk) => ({
        apiBookmakerId: bk.id,
        name: bk.name,
        markets: mapBookmakerMarkets(bk, allowedMarketNames),
      }))
      .filter((bk) => bk.markets.length > 0),
  };
}

export function flattenOdds(parsed) {
  const rows = [];
  for (const bk of parsed.bookmakers) {
    for (const market of bk.markets) {
      for (const v of market.values) {
        rows.push({
          bookmakerApiId: bk.apiBookmakerId,
          bookmakerName: bk.name,
          marketName: market.name,
          value: v.value,
          odd: v.odd,
        });
      }
    }
  }
  return rows;
}
