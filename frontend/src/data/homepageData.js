export const topHeaderData = {
  brand: "Sokasport",
  balanceLabel: "1 ETB",
  timeLabel: "ID: 726",
};

/** Labels come from i18n `nav.*` via `PrimaryNav`. */
export const topNavItems = [
  { id: "home", icon: "home", path: "/" },
  { id: "live", icon: "radio", path: "/live" },
  { id: "games", icon: "gamepad", path: "/casino" },
];

export const topLeagues = [
  { id: "wcq", label: "World - FIFA World Cup Qualific..", icon: "circleDot" },
  { id: "ucl", label: "Europe - UEFA Champions Leag..", icon: "circleDot" },
  { id: "uel", label: "Europe - UEFA Europa League", icon: "circleDot" },
  { id: "uecl", label: "Europe - UEFA Conference Leag..", icon: "circleDot" },
  { id: "epl", label: "England - Premier League", icon: "circleDot" },
  { id: "laliga", label: "Spain - La Liga", icon: "circleDot" },
  { id: "bundesliga", label: "Germany - Bundesliga", icon: "circleDot" },
];

export const sportsList = [
  {
    id: "football",
    name: "FOOTBALL",
    icon: "circleDot",
    count: 1492,
  },
  { id: "basketball", name: "BASKETBALL", icon: "dribbble", count: 214 },
  { id: "tennis", name: "TENNIS", icon: "circle", count: 8 },
  { id: "table-tennis", name: "TABLE TENNIS", icon: "table", count: 282 },
  { id: "volleyball", name: "VOLLEYBALL", icon: "volleyball", count: 108 },
];

export const timeFilters = [
  "1 hour",
  "3 hours",
  "6 hours",
  "12 hours",
  "1 day",
  "3 days",
];

export const matchesTabs = [
  { id: "upcoming", label: "UPCOMING MATCHES" },
  { id: "top-leagues", label: "TOP LEAGUES" },
];

export const sportsbookToolbar = {
  sports: [{ id: "football", label: "Football", icon: "circleDot" }],
  /** Day/time row is built in Home via `buildSportsbookTimeOptions()` (5-day window). */
  times: [],
  leagues: [
    "All Leagues",
    "Top 6",
    "Premier League",
    "La Liga",
    "Bundesliga",
    "Serie A",
    "Ligue 1",
    "UEFA Champions League",
    "UEFA Europa League",
    "UEFA Conference League",
    "FA Cup",
  ],
};

// export const matches = [
//   {
//     id: "eng-fa-1",
//     league: "England - FA Cup",
//     match: "Fulham V Southampton",
//     date: "08/03 15:00 2026",
//     markets: [
//       { id: "1", value: "1.51" },
//       { id: "x", value: "4.27" },
//       { id: "2", value: "5.05" },
//       { id: "1x", value: "1.10" },
//       { id: "12", value: "1.16" },
//       { id: "x2", value: "2.35" },
//       { id: "yes", value: "1.72" },
//       { id: "no", value: "1.98" },
//     ],
//     sideBets: 1253,
//     detailedOdds: {
//       main: [
//         {
//           category: "To Qualify",
//           odds: [
//             { id: "1", value: "1.25" },
//             { id: "2", value: "3.49" },
//           ],
//         },
//         {
//           category: "Match Result",
//           odds: [
//             { id: "1", value: "1.51" },
//             { id: "x", value: "4.27" },
//             { id: "2", value: "5.05" },
//           ],
//         },
//         {
//           category: "1UP",
//           icon: "clock",
//           odds: [
//             { id: "1", value: "1.23" },
//             { id: "x", value: "4.27" },
//             { id: "2", value: "2.28" },
//           ],
//         },
//         {
//           category: "2UP",
//           icon: "clock",
//           odds: [
//             { id: "1", value: "1.5" },
//             { id: "x", value: "4.27" },
//             { id: "2", value: "5.03" },
//           ],
//         },
//       ],
//       extra: [
//         {
//           category: "Double Chance",
//           expandable: true,
//           odds: [
//             { id: "1x", value: "1.10" },
//             { id: "12", value: "1.16" },
//             { id: "x2", value: "2.35" },
//           ],
//         },
//         {
//           category: "Both Teams to Score",
//           expandable: true,
//           odds: [
//             { id: "yes", value: "1.72" },
//             { id: "no", value: "1.98" },
//           ],
//         },
//         {
//           category: "Correct Score",
//           expandable: true,
//           odds: [
//             { id: "1-0", value: "5.50" },
//             { id: "2-0", value: "7.00" },
//             { id: "2-1", value: "8.50" },
//             { id: "0-0", value: "11.0" },
//             { id: "1-1", value: "6.00" },
//             { id: "0-1", value: "12.0" },
//             { id: "0-2", value: "22.0" },
//             { id: "3-0", value: "12.0" },
//           ],
//         },
//         {
//           category: "Draw No Bet",
//           expandable: true,
//           odds: [
//             { id: "1", value: "1.20" },
//             { id: "2", value: "3.80" },
//           ],
//         },
//         {
//           category: "Over/Under 2.5",
//           expandable: true,
//           odds: [
//             { id: "over", value: "1.85" },
//             { id: "under", value: "1.88" },
//           ],
//         },
//         {
//           category: "Half Time Result",
//           expandable: true,
//           odds: [
//             { id: "1", value: "1.90" },
//             { id: "x", value: "2.20" },
//             { id: "2", value: "6.50" },
//           ],
//         },
//       ],
//     },
//   },
//   {
//     id: "eng-fa-2",
//     league: "England - FA Cup",
//     match: "Port Vale V Sunderland",
//     date: "08/03 16:30 2026",
//     markets: [
//       { id: "1", value: "6.39" },
//       { id: "x", value: "4.08" },
//       { id: "2", value: "1.44" },
//       { id: "1x", value: "2.42" },
//       { id: "12", value: "1.18" },
//       { id: "x2", value: "1.05" },
//       { id: "yes", value: "1.83" },
//       { id: "no", value: "1.87" },
//     ],
//     sideBets: 1146,
//     detailedOdds: {
//       main: [
//         {
//           category: "To Qualify",
//           odds: [
//             { id: "1", value: "3.80" },
//             { id: "2", value: "1.22" },
//           ],
//         },
//         {
//           category: "Match Result",
//           odds: [
//             { id: "1", value: "6.39" },
//             { id: "x", value: "4.08" },
//             { id: "2", value: "1.44" },
//           ],
//         },
//       ],
//       extra: [
//         {
//           category: "Double Chance",
//           expandable: true,
//           odds: [
//             { id: "1x", value: "2.42" },
//             { id: "12", value: "1.18" },
//             { id: "x2", value: "1.05" },
//           ],
//         },
//         {
//           category: "Both Teams to Score",
//           expandable: true,
//           odds: [
//             { id: "yes", value: "1.83" },
//             { id: "no", value: "1.87" },
//           ],
//         },
//         {
//           category: "Over/Under 2.5",
//           expandable: true,
//           odds: [
//             { id: "over", value: "2.10" },
//             { id: "under", value: "1.67" },
//           ],
//         },
//       ],
//     },
//   },
//   {
//     id: "eng-fa-3",
//     league: "England - FA Cup",
//     match: "Leeds United V Norwich City",
//     date: "08/03 19:30 2026",
//     markets: [
//       { id: "1", value: "1.42" },
//       { id: "x", value: "4.37" },
//       { id: "2", value: "6.16" },
//       { id: "1x", value: "1.08" },
//       { id: "12", value: "1.13" },
//       { id: "x2", value: "2.55" },
//       { id: "yes", value: "1.68" },
//       { id: "no", value: "2.05" },
//     ],
//     sideBets: 1240,
//     detailedOdds: {
//       main: [
//         {
//           category: "To Qualify",
//           odds: [
//             { id: "1", value: "1.18" },
//             { id: "2", value: "3.95" },
//           ],
//         },
//         {
//           category: "Match Result",
//           odds: [
//             { id: "1", value: "1.42" },
//             { id: "x", value: "4.37" },
//             { id: "2", value: "6.16" },
//           ],
//         },
//       ],
//       extra: [
//         {
//           category: "Double Chance",
//           expandable: true,
//           odds: [
//             { id: "1x", value: "1.08" },
//             { id: "12", value: "1.13" },
//             { id: "x2", value: "2.55" },
//           ],
//         },
//         {
//           category: "Both Teams to Score",
//           expandable: true,
//           odds: [
//             { id: "yes", value: "1.68" },
//             { id: "no", value: "2.05" },
//           ],
//         },
//       ],
//     },
//   },
//   {
//     id: "eng-fa-4",
//     league: "England - FA Cup",
//     match: "West Ham United V Brentford",
//     date: "09/03 22:30 2026",
//     markets: [
//       { id: "1", value: "2.89" },
//       { id: "x", value: "3.37" },
//       { id: "2", value: "3.21" },
//       { id: "1x", value: "1.56" },
//       { id: "12", value: "1.52" },
//       { id: "x2", value: "1.64" },
//       { id: "yes", value: "1.55" },
//       { id: "no", value: "2.25" },
//     ],
//     sideBets: 1172,
//     detailedOdds: {
//       main: [
//         {
//           category: "To Qualify",
//           odds: [
//             { id: "1", value: "1.65" },
//             { id: "2", value: "2.10" },
//           ],
//         },
//         {
//           category: "Match Result",
//           odds: [
//             { id: "1", value: "2.89" },
//             { id: "x", value: "3.37" },
//             { id: "2", value: "3.21" },
//           ],
//         },
//       ],
//       extra: [
//         {
//           category: "Double Chance",
//           expandable: true,
//           odds: [
//             { id: "1x", value: "1.56" },
//             { id: "12", value: "1.52" },
//             { id: "x2", value: "1.64" },
//           ],
//         },
//         {
//           category: "Both Teams to Score",
//           expandable: true,
//           odds: [
//             { id: "yes", value: "1.55" },
//             { id: "no", value: "2.25" },
//           ],
//         },
//         {
//           category: "Correct Score",
//           expandable: true,
//           odds: [
//             { id: "1-0", value: "6.50" },
//             { id: "2-0", value: "9.00" },
//             { id: "2-1", value: "8.00" },
//             { id: "0-0", value: "9.50" },
//             { id: "1-1", value: "5.50" },
//             { id: "0-1", value: "7.00" },
//           ],
//         },
//         {
//           category: "Over/Under 2.5",
//           expandable: true,
//           odds: [
//             { id: "over", value: "1.75" },
//             { id: "under", value: "2.00" },
//           ],
//         },
//         {
//           category: "Half Time Result",
//           expandable: true,
//           odds: [
//             { id: "1", value: "2.50" },
//             { id: "x", value: "2.05" },
//             { id: "2", value: "3.90" },
//           ],
//         },
//         {
//           category: "Draw No Bet",
//           expandable: true,
//           odds: [
//             { id: "1", value: "1.70" },
//             { id: "2", value: "2.00" },
//           ],
//         },
//       ],
//     },
//   },
//   {
//     id: "spain-1",
//     league: "Spain - La Liga",
//     match: "Osasuna V Mallorca",
//     date: "07/03 16:00 2026",
//     markets: [
//       { id: "1", value: "1.82" },
//       { id: "x", value: "3.29" },
//       { id: "2", value: "4.30" },
//       { id: "1x", value: "1.18" },
//       { id: "12", value: "1.28" },
//       { id: "x2", value: "1.85" },
//       { id: "yes", value: "1.96" },
//       { id: "no", value: "1.74" },
//     ],
//     sideBets: 158,
//     detailedOdds: {
//       main: [
//         {
//           category: "To Qualify",
//           odds: [
//             { id: "1", value: "1.40" },
//             { id: "2", value: "2.70" },
//           ],
//         },
//         {
//           category: "Match Result",
//           odds: [
//             { id: "1", value: "1.82" },
//             { id: "x", value: "3.29" },
//             { id: "2", value: "4.30" },
//           ],
//         },
//       ],
//       extra: [
//         {
//           category: "Double Chance",
//           expandable: true,
//           odds: [
//             { id: "1x", value: "1.18" },
//             { id: "12", value: "1.28" },
//             { id: "x2", value: "1.85" },
//           ],
//         },
//         {
//           category: "Both Teams to Score",
//           expandable: true,
//           odds: [
//             { id: "yes", value: "1.96" },
//             { id: "no", value: "1.74" },
//           ],
//         },
//       ],
//     },
//   },
//   {
//     id: "italy-1",
//     league: "Italy - Serie A",
//     match: "Lecce V AC Milan",
//     date: "07/03 17:00 2026",
//     markets: [
//       { id: "1", value: "4.45" },
//       { id: "x", value: "3.72" },
//       { id: "2", value: "1.74" },
//       { id: "1x", value: "2.16" },
//       { id: "12", value: "1.26" },
//       { id: "x2", value: "1.27" },
//       { id: "yes", value: "2.03" },
//       { id: "no", value: "1.67" },
//     ],
//     sideBets: 301,
//     detailedOdds: {
//       main: [
//         {
//           category: "To Qualify",
//           odds: [
//             { id: "1", value: "2.90" },
//             { id: "2", value: "1.35" },
//           ],
//         },
//         {
//           category: "Match Result",
//           odds: [
//             { id: "1", value: "4.45" },
//             { id: "x", value: "3.72" },
//             { id: "2", value: "1.74" },
//           ],
//         },
//       ],
//       extra: [
//         {
//           category: "Double Chance",
//           expandable: true,
//           odds: [
//             { id: "1x", value: "2.16" },
//             { id: "12", value: "1.26" },
//             { id: "x2", value: "1.27" },
//           ],
//         },
//         {
//           category: "Both Teams to Score",
//           expandable: true,
//           odds: [
//             { id: "yes", value: "2.03" },
//             { id: "no", value: "1.67" },
//           ],
//         },
//         {
//           category: "Over/Under 2.5",
//           expandable: true,
//           odds: [
//             { id: "over", value: "1.90" },
//             { id: "under", value: "1.83" },
//           ],
//         },
//       ],
//     },
//   },
// ];

// export const betSlipTabs = [
//   { id: "betslip1", label: "BETSLIP 1", active: true },
//   { id: "betslip2", label: "BETSLIP 2" },
//   { id: "betslip3", label: "BETSLIP 3" },
// ];

// export const betSlipSelection = {
//   title: "NEWCASTLE UNITED V MANCHESTER UNITED",
//   subtitle: "BOTH TEAMS TO SCORE: YES",
//   odd: "1.44",
//   stake: "20",
// };

// export const betSlipSummary = [
//   { id: "total", label: "Total bet amount", value: "20 ETB" },
//   { id: "tax", label: "Income Tax 15%", value: "1.32 ETB", accent: true },
//   { id: "net", label: "Net Win/Payout", value: "27.48 ETB" },
// ];
