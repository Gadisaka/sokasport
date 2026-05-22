/**
 * Football fixture market grouping for expanded-row tab filters.
 * Keys are semantic tab ids; values are canonical English labels aligned with trading copy.
 *
 * Matching: normalizeMarketName(market.name) must hit a catalog string or LABEL_ALIASES.
 * Markets may appear under multiple tabs (e.g. Asian Handicap → main-market + handicaps).
 *
 * Companion doc: frontend/docs/fixture-market-filters-plan.md
 */

/** @typedef {typeof MARKET_FILTER_TAB_IDS[number]} MarketFilterTabId */

export const MARKET_FILTER_TAB_IDS = /** @type {const} */ ([
  "main-market",
  "goals",
  "combination",
  "half-time",
  "corners",
  "cards",
  "yellow-cards",
  "offsides",
  "shots",
  "shots-on-target",
  "minutes",
  "handicaps",
]);

/** UI labels (production order; "All" is synthetic in the component). */
export const MARKET_FILTER_TAB_LABEL = {
  "main-market": "Main Market",
  goals: "Goals",
  combination: "Combination",
  "half-time": "Half Time",
  corners: "Corners",
  cards: "Cards",
  "yellow-cards": "Yellow Cards",
  offsides: "Offsides",
  shots: "Shots",
  "shots-on-target": "Shots on Target",
  minutes: "Minutes",
  handicaps: "Handicaps",
};

/** Synthetic chip id for the All tab */
export const MARKET_FILTER_ALL_CHIP_ID = /** @type {const} */ ("all");

/** @typedef {'all'|MarketFilterTabId} MarketFilterChipId */

export const MARKET_FILTER_CHIPS =
  /** @type {readonly { id: MarketFilterChipId; label: string }[]} */ (
    Object.freeze([
      { id: MARKET_FILTER_ALL_CHIP_ID, label: "All" },
      ...MARKET_FILTER_TAB_IDS.map((id) => ({
        id,
        label: MARKET_FILTER_TAB_LABEL[id],
      })),
    ])
  );

/**
 * @param {unknown} chipId
 * @returns {boolean}
 */
export function isAllChipId(chipId) {
  return chipId === MARKET_FILTER_ALL_CHIP_ID;
}

const MAIN_MARKET = [
  "Match Winner",
  "Home/Away",
  "Double Chance",
  "Draw No Bet",
  "Handicap Result",
  "Asian Handicap",
  "To Qualify",
  "HT/FT Double",
  "First Half Winner",
  "Second Half Winner",
  "Exact Score",
  "Correct Score - First Half",
  "Correct Score - Second Half",
  "Winning Margin",
  "Win Both Halves",
  "To Win Either Half",
  "Team To Score First",
  "Team To Score Last",
  "First Team to Score",
  "Last Team to Score",
  "Clean Sheet",
  "Win To Nil",
  "Method of Victory",
  "To Advance Handicap",
];

const GOALS = [
  "Goals Over/Under",
  "Goals Over/Under First Half",
  "Goals Over/Under - Second Half",
  "Total - Home",
  "Total - Away",
  "Goal Line",
  "Goal Line (1st Half)",
  "Total Goals (3 way)",
  "Exact Goals Number",
  "Exact Goals Number - First Half",
  "Total Goals Number By Ranges",
  "Total Goals By Ranges (1st Half)",
  "Number of Goals In Match (Range)",
  "Home Team Total Goals(1st Half)",
  "Away Team Total Goals(1st Half)",
  "Home Team Total Goals(2nd Half)",
  "Away Team Total Goals(2nd Half)",
  "Home Team Exact Goals Number",
  "Away Team Exact Goals Number",
  "Home Exact Goals Number (1st Half)",
  "Away Exact Goals Number (1st Half)",
  "Odd/Even",
  "Odd/Even - First Half",
  "Odd/Even - Second Half",
  "Home Odd/Even",
  "Away Odd/Even",
  "Over/Under between 0 and 10m",
  "Over/Under 15m-30m",
  "Over/Under 30m-45m",
  "Goal in 1-15 minutes",
  "Goal in 16-30 minutes",
  "Goal in 31-45 minutes",
  "Goal in 46-60 minutes",
  "Goal in 61-75 minutes",
  "Goal in 76-90 minutes",
];

const COMBINATION = [
  "Results/Both Teams Score",
  "Result/Total Goals",
  "Total Goals/Both Teams To Score",
  "Halftime Result/Total Goals",
  "Halftime Result/Both Teams Score",
  "Both Teams to Score 1st Half - 2nd Half",
  "Double Chance/Total",
  "Result/Total Goals (2nd Half)",
  "Double Chance/Both Teams To Score",
  "Home Win/Over",
  "Home Win/Under",
  "Away Win/Over",
  "Away Win/Under",
  "Home Not lose/Over",
  "Home Not lose/Under",
  "Away Not lose/Over",
  "Away Not lose/Under",
  "Win To Nil",
  "Home Win To Nil (1st Half)",
  "Home Win To Nil (2nd Half)",
  "Away Win To Nil (1st Half)",
  "Away Win To Nil (2nd Half)",
];

const HALF_TIME = [
  "First Half Winner",
  "Second Half Winner",
  "Double Chance - First Half",
  "Double Chance - Second Half",
  "Draw No Bet (1st Half)",
  "Draw No Bet (2nd Half)",
  "Goals Over/Under First Half",
  "Goals Over/Under - Second Half",
  "Both Teams Score - First Half",
  "Both Teams To Score - Second Half",
  "Correct Score - First Half",
  "Correct Score - Second Half",
  "Asian Handicap First Half",
  "Asian Handicap (2nd Half)",
  "Handicap Result - First Half",
  "Odd/Even - First Half",
  "Odd/Even - Second Half",
  "Goal Line (1st Half)",
  "Corners 1x2 (1st Half)",
  "Corners 1x2 (2nd Half)",
  "Total Corners (1st Half)",
  "Total Corners (2nd Half)",
  "Yellow Over/Under (1st Half)",
  "Yellow Over/Under (2nd Half)",
  "Penalty Awarded (1st Half)",
  "Penalty Awarded (2nd Half)",
];

const CORNERS = [
  "Corners Over Under",
  "Corners 1x2",
  "Corners Asian Handicap",
  "Home Corners Over/Under",
  "Away Corners Over/Under",
  "First Corner",
  "Last Corner",
  "Total Corners (1st Half)",
  "Total Corners (2nd Half)",
  "Total Corners (3 way)",
  "Total Corners (3 way) (1st Half)",
  "Total Corners (3 way) (2nd Half)",
  "Corners Asian Handicap (1st Half)",
  "Corners Asian Handicap (2nd Half)",
  "Home Total Corners (1st Half)",
  "Home Total Corners (2nd Half)",
  "Away Total Corners (1st Half)",
  "Away Total Corners (2nd Half)",
  "Corners. First Corner (3 way)",
  "Corners Race To",
  "Corners. European Handicap",
  "Corners. Total (Range)",
  "Corners. total between 0 and 10m",
  "Corners. Double Chance",
  "Corners. Odd/Even",
  "Corner in 1-15 minutes",
  "Corner in 16-30 minutes",
  "Corner in 31-45 minutes",
  "Corner in 45-60 minutes",
  "Corner in 60-75 minutes",
  "Corner in 75-90 minutes",
  "Multicorners",
];

const CARDS = [
  "Cards European Handicap",
  "Cards Over/Under",
  "Cards Asian Handicap",
  "Home Team Total Cards",
  "Away Team Total Cards",
  "First Card Received (3 way)",
  "Both Teams to Receive a Card",
  "Both Teams to Receive 2+ Cards",
  "Red Cards Over/Under",
  "Red Card In The Match (1st Half)",
  "Player to be booked",
  "Player to be Sent Off",
];

const YELLOW_CARDS = [
  "Home Team Yellow Cards",
  "Away Team Yellow Cards",
  "Yellow Asian Handicap",
  "Yellow Over/Under",
  "Yellow Double Chance",
  "Yellow Over/Under (1st Half)",
  "Yellow Over/Under (2nd Half)",
  "Yellow Odd/Even",
  "Yellow Cards 1x2",
  "Yellow Asian Handicap (1st Half)",
  "Yellow Asian Handicap (2nd Half)",
  "Yellow Cards 1x2 (1st Half)",
  "Yellow Cards 1x2 (2nd Half)",
  "Yellow Cards. Odd/Even (1st Half)",
  "Yellow Cards. Odd/Even (2nd Half)",
  "Yellow Cards. Home Total (1st Half)",
  "Yellow Cards Away Total (1st Half)",
];

const OFFSIDES = [
  "Offsides Total",
  "Offsides 1x2",
  "Offsides Handicap",
  "Offsides Home Total",
  "Offsides Away Total",
  "Offsides Double Chance",
  "Offsides Odd/Even",
];

const SHOTS = [
  "Total Shots",
  "Shots. Home Total",
  "Shots. Away Total",
  "Shots.1x2",
  "Home Player Shots",
  "Away Player Shots",
  "Player Shots Total",
  "Home Player Shots Total",
  "Away Player Shots Total",
];

const SHOTS_ON_TARGET = [
  "Shot on Target",
  "Total ShotOnGoal",
  "Home Total ShotOnGoal",
  "Away Total ShotOnGoal",
  "ShotOnTarget 1x2",
  "ShotOnTarget Handicap",
  "ShotOnTarget Double Chance",
  "Player Shots On Target",
  "Player Shots On Target Total",
  "Home Shots On Target",
  "Away Shots On Target",
  "Home Player Shots On Target Total",
  "Away Player Shots On Target Total",
];

const MINUTES = [
  "1x2 - 15 minutes",
  "1x2 - 20 minutes",
  "1x2 - 30 minutes",
  "1x2 - 60 minutes",
  "1x2 - 70 minutes",
  "1x2 - 75 minutes",
  "DC - 15 minutes",
  "DC - 30 minutes",
  "DC - 60 minutes",
  "DC - 75 minutes",
  "Double Chance 0-15m",
  "Double Chance 15-30m",
  "Double Chance 30-45m",
  "Goal in 1-15 minutes",
  "Goal in 16-30 minutes",
  "Goal in 31-45 minutes",
  "Goal in 46-60 minutes",
  "Goal in 61-75 minutes",
  "Goal in 76-90 minutes",
  "Time Of 1st Score",
  "Team Time Of 1st Score",
  "Time of First Goal Brackets (Range)",
  "Total Goal Minutes (Range)",
  "Late Goal (Range)",
  "Early Goal (Range)",
];

const HANDICAPS = [
  "Asian Handicap",
  "Asian Handicap First Half",
  "Asian Handicap (2nd Half)",
  "Handicap Result",
  "Handicap Result - First Half",
  "European Handicap (2nd Half)",
  "Cards European Handicap",
  "Cards Asian Handicap",
  "Corners Asian Handicap",
  "Corners. European Handicap",
  "Corners Asian Handicap (1st Half)",
  "Corners Asian Handicap (2nd Half)",
  "Offsides Handicap",
  "ShotOnTarget Handicap",
  "Fouls. Handicap",
  "Yellow Asian Handicap",
  "Yellow Asian Handicap (1st Half)",
  "Yellow Asian Handicap (2nd Half)",
  "Saves Asian H",
  "To Advance Handicap",
];

export const MARKETS_BY_TAB = /** @type {Record<MarketFilterTabId, readonly string[]>} */ ({
  "main-market": MAIN_MARKET,
  goals: GOALS,
  combination: COMBINATION,
  "half-time": HALF_TIME,
  corners: CORNERS,
  cards: CARDS,
  "yellow-cards": YELLOW_CARDS,
  offsides: OFFSIDES,
  shots: SHOTS,
  "shots-on-target": SHOTS_ON_TARGET,
  minutes: MINUTES,
  handicaps: HANDICAPS,
});

/**
 * Incoming API synonyms → canonical catalog key (post-normalization of the value side).
 * Keys and values should match what normalizeMarketName produces.
 */
export const LABEL_ALIASES = {
  "fulltime result": "match winner",
  "full time result": "match winner",
  "1x2": "match winner",
  "match result": "match winner",
  "home win to nill (1st half)": "home win to nil (1st half)",
  "home win to nill (2nd half)": "home win to nil (2nd half)",
  "away win to nill (1st half)": "away win to nil (1st half)",
  "away win to nill (2nd half)": "away win to nil (2nd half)",
};

function foldUnicode(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .trim();
}

/**
 * Normalize a market name for catalog lookup (not for display).
 * @param {string} name
 */
export function normalizeMarketName(name) {
  const folded = foldUnicode(name).toLowerCase();
  return folded.replace(/\s+/g, " ");
}

function buildReverseIndex() {
  /** @type {Map<string, Set<MarketFilterTabId>>} */
  const map = new Map();

  for (const tabId of MARKET_FILTER_TAB_IDS) {
    const list = MARKETS_BY_TAB[tabId] || [];
    for (const label of list) {
      const key = normalizeMarketName(label);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(tabId);
    }
  }

  for (const [alias, canonical] of Object.entries(LABEL_ALIASES)) {
    const aliasKey = normalizeMarketName(alias);
    const canonicalKey = normalizeMarketName(canonical);
    const tabs = map.get(canonicalKey);
    if (tabs) map.set(aliasKey, new Set(tabs));
  }

  return map;
}

const REVERSE_INDEX = buildReverseIndex();

/**
 * Which filter tabs should include this market name.
 * @param {string} marketName - raw `market.name` from API
 * @returns {Set<MarketFilterTabId>}
 */
export function getTabsForMarketName(marketName) {
  const key = normalizeMarketName(marketName);
  const direct = REVERSE_INDEX.get(key);
  if (direct && direct.size) return new Set(direct);

  const viaAlias = LABEL_ALIASES[key];
  if (viaAlias) {
    const tabs = REVERSE_INDEX.get(normalizeMarketName(viaAlias));
    if (tabs && tabs.size) return new Set(tabs);
  }

  return new Set();
}

/**
 * @param {Array<{ category: string, odds?: unknown }>} categories
 * @param {MarketFilterChipId|string} chipId
 */
export function filterCategoriesByChipId(categories, chipId) {
  if (!Array.isArray(categories)) return [];
  if (chipId === MARKET_FILTER_ALL_CHIP_ID) return categories;
  return categories.filter((c) =>
    getTabsForMarketName(c.category).has(
      /** @type {MarketFilterTabId} */ (chipId),
    ),
  );
}
