/**
 * One-shot helper: parses backend/markets.md and prints suggested
 * BET_ID → canonical_code counts. Run: node scripts/generateApiSportsBetMap.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mdPath = path.join(__dirname, "..", "markets.md");
const text = fs.readFileSync(mdPath, "utf8");
const lines = text.split(/\r?\n/);
const pairs = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^id: (\d+)$/);
  if (m) {
    const nm = lines[i + 1];
    const mm = nm && nm.match(/^name: "(.+)"$/);
    if (mm) pairs.push({ id: +m[1], name: mm[1] });
  }
}

function guess(name) {
  const s = name.toLowerCase();
  const T = (p) => s.includes(p);
  if (/^match winner$/i.test(name)) return "MATCH_WINNER";
  if (name === "Home/Away") return "HOME_AWAY";
  if (/second half winner/i.test(s) && !T("corner")) return "SECOND_HALF_RESULT";
  if (/asian handicap/i.test(s) && /sets/i.test(s)) return "APISPORTS_UNSUPPORTED_SPORT";
  if (/asian handicap/i.test(s) && /(1st|first)\s+half/i.test(s)) return "HANDICAP_ASIAN_HT";
  if (/asian handicap/i.test(s) && /(2nd|second)\s+half/i.test(s)) return "HANDICAP_ASIAN_SH";
  if (/^asian handicap$/i.test(name)) return "HANDICAP_ASIAN";
  if (/corners asian handicap/i.test(s)) return "CORNERS_HANDICAP_ASIAN";
  if (/yellow asian handicap/i.test(s)) return "YELLOW_CARDS_HANDICAP_ASIAN";
  if (/cards asian handicap/i.test(s)) return "CARDS_ASIAN_HANDICAP";
  if (/goal line/i.test(s) && T("1st half")) return "GOAL_LINE_HT";
  if (/goal line/i.test(s)) return "GOAL_LINE_FT";
  if (/goals over\/under.*first half/i.test(s)) return "HT_OVER_UNDER";
  if (/goals over\/under.*second half/i.test(s)) return "SH_OVER_UNDER";
  if (/goals over\/under/i.test(s)) return "OVER_UNDER";
  if (/ht\/ft/i.test(s)) return "HT_FT";
  if (/both teams score.*first half/i.test(s)) return "BTTS_HT";
  if (/both teams.*second half/i.test(s)) return "BTTS_SH";
  if (/both teams score/i.test(s)) return "BTTS";
  if (/handicap result.*first half/i.test(s)) return "HANDICAP_EUROPEAN_HT";
  if (/handicap result/i.test(s)) return "HANDICAP_EUROPEAN";
  if (/correct score.*first half/i.test(s)) return "CORRECT_SCORE_HT";
  if (/correct score.*second half/i.test(s)) return "CORRECT_SCORE_SH";
  if (/exact score.*first half/i.test(s)) return "CORRECT_SCORE_HT";
  if (/exact score.*second half/i.test(s)) return "CORRECT_SCORE_SH";
  if (/^exact score$/i.test(name)) return "CORRECT_SCORE";
  if (/double chance.*first half/i.test(s)) return "DOUBLE_CHANCE_HT";
  if (/double chance.*second half/i.test(s)) return "DOUBLE_CHANCE_SH";
  if (/double chance\/total/i.test(s)) return "DOUBLE_CHANCE_TOTAL_FT";
  if (/double chance\/both/i.test(s)) return "DOUBLE_CHANCE_BTTS_FT";
  if (/double chance/i.test(s) && /\d/.test(name)) return "APISPORTS_TIME_WINDOW"; // DC 0-15m etc.
  if (/double chance/i.test(s)) return "DOUBLE_CHANCE";
  if (/first half winner/i.test(s)) return "HALF_TIME_RESULT";
  if (/odd\/even.*first half/i.test(s)) return "ODD_EVEN_HT";
  if (/odd\/even.*second half/i.test(s)) return "ODD_EVEN_SH";
  if (/home odd\/even/i.test(s)) return "ODD_EVEN_HOME_TEAM";
  if (/away odd\/even/i.test(s)) return "ODD_EVEN_AWAY_TEAM";
  if (/^odd\/even/i.test(name) || name === "Odd/Even") return "ODD_EVEN";
  if (/results\/both/i.test(s)) return "RESULT_BTTS";
  if (/result\/total/i.test(s) && T("2nd half")) return "RESULT_TOTAL_SH";
  if (/result\/total/i.test(s)) return "RESULT_TOTAL_FT";
  if (/total - home/i.test(s)) return "TEAM_TOTAL_HOME";
  if (/total - away/i.test(s)) return "TEAM_TOTAL_AWAY";
  if (/team to score first/i.test(s)) return "TEAM_FIRST_GOAL";
  if (/team to score last/i.test(s)) return "TEAM_LAST_GOAL";
  if (/which team will score the 1st goal/i.test(s)) return "TEAM_FIRST_GOAL";
  if (/first team to score/i.test(s) && T("3 way") && T("1st half"))
    return "FIRST_TEAM_SCORE_3WAY_HT";
  if (/first team to score/i.test(s) && T("3 way") && T("2nd half"))
    return "FIRST_TEAM_SCORE_3WAY_SH";
  if (/first team to score/i.test(s)) return "FIRST_TEAM_SCORE";
  if (/last team to score/i.test(s)) return "LAST_TEAM_SCORE";
  if (/clean sheet - home/i.test(s)) return "CLEAN_SHEET_HOME";
  if (/clean sheet - away/i.test(s)) return "CLEAN_SHEET_AWAY";
  if (/^clean sheet$/i.test(name)) return "CLEAN_SHEET_EITHER";
  if (/win to nil/i.test(s) && T("home") && T("half")) return "WIN_TO_NIL_HOME_HALF";
  if (/win to nil/i.test(s) && T("away") && T("half")) return "WIN_TO_NIL_AWAY_HALF";
  if (/win to nil/i.test(s) && T("home")) return "WIN_TO_NIL_HOME";
  if (/win to nil/i.test(s) && T("away")) return "WIN_TO_NIL_AWAY";
  if (/^win to nil$/i.test(name)) return "WIN_TO_NIL";
  if (/win both halves/i.test(s)) return "WIN_BOTH_HALVES";
  if (/home win both halves/i.test(s)) return "HOME_WIN_BOTH_HALVES";
  if (/away win both halves/i.test(s)) return "AWAY_WIN_BOTH_HALVES";
  if (/exact goals number.*first half/i.test(s)) return "EXACT_GOALS_HT";
  if (/exact goals number/i.test(s) && T("second half")) return "EXACT_GOALS_SH";
  if (/home team exact/i.test(s) && T("half")) return "EXACT_GOALS_HOME_HT";
  if (/away team exact/i.test(s) && T("half")) return "EXACT_GOALS_AWAY_HT";
  if (/home team exact/i.test(s)) return "EXACT_GOALS_HOME_FT";
  if (/away team exact/i.test(s)) return "EXACT_GOALS_AWAY_FT";
  if (/second half exact goals/i.test(s)) return "EXACT_GOALS_SH";
  if (/exact goals number/i.test(s)) return "EXACT_GOALS_FT";
  if (/home team score a goal/i.test(s) && T("1st")) return "TEAM_TO_SCORE_YESNO_HOME_HT";
  if (/home team score a goal/i.test(s) && T("2nd")) return "TEAM_TO_SCORE_YESNO_HOME_SH";
  if (/away team score a goal/i.test(s) && T("1st")) return "TEAM_TO_SCORE_YESNO_AWAY_HT";
  if (/away team score a goal/i.test(s) && T("2nd")) return "TEAM_TO_SCORE_YESNO_AWAY_SH";
  if (/home team score a goal/i.test(s)) return "TEAM_TO_SCORE_YESNO_HOME";
  if (/away team score a goal/i.test(s)) return "TEAM_TO_SCORE_YESNO_AWAY";
  if (/corners over under/i.test(s)) return "CORNERS_OVER_UNDER";
  if (/total corners.*1st half/i.test(s) && T("3 way")) return "CORNERS_TOTAL_3WAY_HT";
  if (/total corners.*2nd half/i.test(s) && T("3 way")) return "CORNERS_TOTAL_3WAY_SH";
  if (/total corners.*3 way/i.test(s)) return "CORNERS_TOTAL_3WAY_FT";
  if (/corners 1x2/i.test(s) && T("1st")) return "CORNERS_1X2_HT";
  if (/corners 1x2/i.test(s) && T("2nd")) return "CORNERS_1X2_SH";
  if (/corners 1x2/i.test(s)) return "CORNERS_1X2_FT";
  if (/home total corners/i.test(s) && T("1st")) return "CORNERS_TEAM_OU_HOME_HT";
  if (/home total corners/i.test(s) && T("2nd")) return "CORNERS_TEAM_OU_HOME_SH";
  if (/away total corners/i.test(s) && T("1st")) return "CORNERS_TEAM_OU_AWAY_HT";
  if (/away total corners/i.test(s) && T("2nd")) return "CORNERS_TEAM_OU_AWAY_SH";
  if (/home corners over/i.test(s)) return "CORNERS_TEAM_OU_HOME_FT";
  if (/away corners over/i.test(s)) return "CORNERS_TEAM_OU_AWAY_FT";
  if (/total corners.*2nd half/i.test(s)) return "CORNERS_TOTAL_SH";
  if (/total corners \(1st half\)/i.test(name)) return "CORNERS_TOTAL_HT";
  if (/cards over\/under/i.test(s)) return "CARDS_OVER_UNDER";
  if (/yellow over\/under/i.test(s) && T("1st")) return "YELLOW_CARDS_OU_HT";
  if (/yellow over\/under/i.test(s) && T("2nd")) return "YELLOW_CARDS_OU_SH";
  if (/yellow over\/under/i.test(s)) return "YELLOW_CARDS_OU_FT";
  if (/cards european handicap/i.test(s)) return "CARDS_HANDICAP_EUROPEAN";
  if (/home team total cards/i.test(s)) return "CARDS_TEAM_TOTAL_HOME";
  if (/away team total cards/i.test(s)) return "CARDS_TEAM_TOTAL_AWAY";
  if (/yellow cards.*total.*1st half/i.test(s)) return "YELLOW_CARDS_TEAM_HOME_HT"; // approximate
  if (/yellow cards away total.*1st half/i.test(s)) return "YELLOW_CARDS_TEAM_AWAY_HT";
  if (/yellow cards 1x2/i.test(s) && T("1st")) return "YELLOW_CARDS_1X2_HT";
  if (/yellow cards 1x2/i.test(s) && T("2nd")) return "YELLOW_CARDS_1X2_SH";
  if (/yellow cards 1x2/i.test(s)) return "YELLOW_CARDS_1X2_FT";
  if (/yellow double chance/i.test(s)) return "YELLOW_DOUBLE_CHANCE_FT";
  if (/yellow odd\/even/i.test(s)) return "YELLOW_ODD_EVEN_FT";
  if (/yellow cards\. odd\/even/i.test(s)) return "YELLOW_ODD_EVEN_FT";
  if (/winning margin/i.test(s) && T("set")) return "APISPORTS_UNSUPPORTED_SPORT";
  if (/^winning margin$/i.test(name)) return "WINNING_MARGIN";
  if (/anytime goal scorer/i.test(s) && T("away")) return "GOALSCORER_ANYTIME_AWAY";
  if (/anytime goal scorer/i.test(s) && T("home")) return "GOALSCORER_ANYTIME_HOME";
  if (/anytime goal scorer/i.test(s)) return "GOALSCORER_ANYTIME";
  if (/first goal scorer/i.test(s) && T("away")) return "FIRST_GOALSCORER_AWAY";
  if (/first goal scorer/i.test(s) && T("home")) return "FIRST_GOALSCORER_HOME";
  if (/first goal scorer/i.test(s)) return "FIRST_GOALSCORER";
  if (/last goal scorer/i.test(s) && T("away")) return "LAST_GOALSCORER_AWAY";
  if (/last goal scorer/i.test(s) && T("home")) return "LAST_GOALSCORER_HOME";
  if (/last goal scorer/i.test(s)) return "LAST_GOALSCORER";
  if (/player to be booked|player to be sent off|rcard/i.test(s)) return "PLAYER_CARDS";
  if (/player assists/i.test(s)) return "PLAYER_ASSISTS";
  if (/player shots on target total/i.test(s)) return "PLAYER_SHOTS";
  if (/player shots total/i.test(s)) return "PLAYER_SHOTS";
  if (/player shots on target/i.test(s)) return "PLAYER_SHOTS";
  if (/home player shots on target/i.test(s)) return "PLAYER_SHOTS_HOME_WRAPPER";
  if (/away player shots on target/i.test(s)) return "PLAYER_SHOTS_AWAY_WRAPPER";
  if (/home player shots/i.test(s) && !T("on target")) return "PLAYER_SHOTS_HOME_WRAPPER";
  if (/away player shots/i.test(s) && !T("on target")) return "PLAYER_SHOTS_AWAY_WRAPPER";
  if (/draw no bet.*1st/i.test(s)) return "DRAW_NO_BET_HT";
  if (/draw no bet.*2nd/i.test(s)) return "DRAW_NO_BET_SH";
  if (/european handicap.*2nd half/i.test(s)) return "HANDICAP_EUROPEAN_SH";
  if (/total goals\/both/i.test(s)) return "TOTAL_GOALS_BTTS";
  if (/to score in both halves by teams/i.test(s)) return "SCORE_BOTH_HALVES_TEAMS";
  if (/to score in both halves/i.test(s)) return "SCORE_BOTH_HALVES_TEAM";
  if (/home team will score in both halves/i.test(s)) return "HOME_SCORE_BOTH_HALVES";
  if (/away team will score in both halves/i.test(s)) return "AWAY_SCORE_BOTH_HALVES";
  if (/both teams to score in both halves/i.test(s)) return "BTTS_BOTH_HALVES";
  if (/home highest scoring half/i.test(s)) return "HIGHEST_SCORING_HALF_HOME";
  if (/away highest scoring half/i.test(s)) return "HIGHEST_SCORING_HALF_AWAY";
  if (/^highest scoring half$/i.test(name)) return "HIGHEST_SCORING_HALF";
  if (/halftime result\/total/i.test(s)) return "HT_RESULT_TOTAL";
  if (/halftime result\/both/i.test(s)) return "HT_RESULT_BTTS";
  if (/home team will win either half/i.test(s)) return "WIN_EITHER_HALF_HOME";
  if (/away team will win either half/i.test(s)) return "WIN_EITHER_HALF_AWAY";
  if (/^to win either half$/i.test(name)) return "WIN_EITHER_HALF_EITHER";
  if (/home win\/over|home win\/under|away win\/over|away win\/under/i.test(s))
    return "WIN_AND_TOTAL_COMBO";
  if (/home not lose\/over|home not lose\/under|away not lose/i.test(s))
    return "DNB_TOTAL_COMBO";
  if (/double chance\/both teams to score/i.test(s)) return "DOUBLE_CHANCE_BTTS";
  if (/double chance\/total/i.test(s)) return "DOUBLE_CHANCE_TOTAL";
  if (/scoring draw/i.test(name)) return "SCORING_DRAW";
  if (/^10 over\/under$/i.test(name)) return "OVER_UNDER_FIRST_10MIN";
  if (/corner in|goal in/i.test(s) && /\d/.test(name)) return "EVENT_IN_TIME_WINDOW";
  if (/^1x2 /i.test(name) || /^dc /i.test(name)) return "APISPORTS_TIME_WINDOW";
  if (/own goal/i.test(s)) return "APISPORTS_SPECIAL";
  if (/to qualify/i.test(s)) return "APISPORTS_SPECIAL";
  if (/first 10 min|1x2 - \d|odd\/even \(1st set\)|set betting/i.test(s))
    return "APISPORTS_UNSUPPORTED_SPORT";
  if (/offsides|fouls\.|saves |tackles\.|shots\.1x2|shots\. home|shots\. away|total shots/i.test(s))
    return "TEAM_STAT_MARKET";
  if (/shotontarget/i.test(s)) return "TEAM_STAT_MARKET";
  if (/red cards over\/under/i.test(s)) return "RED_CARDS_OU_FT";
  if (/red card in the match/i.test(s)) return "APISPORTS_SPECIAL";
  if (/penalty awarded/i.test(s)) return "APISPORTS_SPECIAL";
  if (/corners\.|corners race|last corner|first corner|multicorners/i.test(s))
    return "APISPORTS_SPECIAL";
  if (/player to score or assist/i.test(s)) return "PLAYER_SCORE_OR_ASSIST";
  if (/goalkeeper saves/i.test(s)) return "TEAM_STAT_MARKET";
  if (/player fouls committed|player tackles|player passes/i.test(s)) return "PLAYER_STAT_OU";
  if (/team goalscorers|team to score \(goals\)/i.test(s)) return "APISPORTS_SPECIAL";
  if (/home team goalscorers|away team goalscorers/i.test(s)) return "APISPORTS_SPECIAL";
  if (/team performances|number of goals in match \(range\)/i.test(s)) return "APISPORTS_SPECIAL";
  if (/game decided|to win from behind|to advance handicap/i.test(s)) return "APISPORTS_SPECIAL";
  if (/either team wins by/i.test(s)) return "APISPORTS_SPECIAL";
  if (/over\/under \d+m-\d+m|over\/under between/i.test(s)) return "APISPORTS_TIME_WINDOW";
  if (/player triples|player points|player singles|touchdown/i.test(s))
    return "APISPORTS_UNSUPPORTED_SPORT";
  if (/ Method of|method of victory|time of first goal brackets/i.test(name))
    return "APISPORTS_SPECIAL";

  return "APISPORTS_SPECIAL"; // rare API-only props — graded via apisportsSpecial.js + apiBetId
}

const counts = {};
const rows = pairs.map((p) => {
  const code = guess(p.name);
  counts[code] = (counts[code] || 0) + 1;
  return { id: p.id, code, name: p.name };
});

const outPath = path.join(__dirname, "..", "services", "markets", "apiSportsBetIdMap.generated.js");
const linesOut = [];
linesOut.push("/** Auto-generated from backend/markets.md — run: node scripts/generateApiSportsBetMap.mjs */");
linesOut.push("export const API_SPORTS_BET_ID_TO_CANONICAL = Object.freeze({");
for (const row of [...rows].sort((a, b) => a.id - b.id)) {
  linesOut.push(`  ${row.id}: "${row.code}",`);
}
linesOut.push("});");
linesOut.push("");
linesOut.push("export const API_SPORTS_CANONICAL_CODES = Object.freeze(");
linesOut.push(`  [...new Set(Object.values(API_SPORTS_BET_ID_TO_CANONICAL))].sort(),`);
linesOut.push(");");
linesOut.push("");
linesOut.push("/** All numeric bet IDs present in markets.md */");
linesOut.push("export const API_SPORTS_BET_IDS = Object.freeze(");
linesOut.push(`  Object.keys(API_SPORTS_BET_ID_TO_CANONICAL).map(Number).sort((a, b) => a - b),`);
linesOut.push(");");
fs.writeFileSync(outPath, linesOut.join("\n") + "\n", "utf8");
console.log("Wrote", outPath);

console.log("Unique IDs:", rows.length);
console.log(counts);
console.log(
  "Fallback META:",
  counts.APISPORTS_EXTENDED_META,
  "UNSUPPORTED_SPORT:",
  counts.APISPORTS_UNSUPPORTED_SPORT,
);
