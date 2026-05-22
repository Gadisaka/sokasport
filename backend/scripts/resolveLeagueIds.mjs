/**
 * Verifies league id mappings against live API-Football /leagues data.
 * Run from repo root: `node backend/scripts/resolveLeagueIds.mjs`
 * Requires `API_FOOTBALL_KEY` in `backend/.env`.
 */
import "dotenv/config";
import axios from "axios";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(join(__dirname, ".."));

const key = process.env.API_FOOTBALL_KEY;
if (!key) {
  console.error("Missing API_FOOTBALL_KEY");
  process.exit(1);
}

const { data } = await axios.get("https://v3.football.api-sports.io/leagues", {
  headers: { "x-apisports-key": key },
});
if (data.errors && Object.keys(data.errors).length) {
  console.error(data.errors);
  process.exit(1);
}
const all = data.response ?? [];

function byId(id) {
  return all.find((e) => e.league.id === id) || null;
}

/** @type {Array<{ label: string, ids: number[] }>} */
const CHECKS = [
  { label: "Top 5", ids: [39, 140, 135, 78, 61] },
  { label: "UEFA club", ids: [2, 3, 848] },
  { label: "Europe extras", ids: [94, 88, 144, 203, 179, 235, 333, 383] },
  { label: "Domestic cups", ids: [45, 48, 143, 137, 81, 66] },
  { label: "Americas", ids: [253, 262, 128, 71] },
  { label: "Asia ME", ids: [307, 98, 169, 504] },
  { label: "Africa", ids: [363, 233, 288, 186] },
  { label: "Lower div", ids: [40, 41, 42, 136, 79, 141] },
  { label: "Scandi", ids: [113, 103, 119] },
  { label: "East EU + others", ids: [106, 345, 210, 197, 323, 188, 305, 301, 292] },
  { label: "International NT", ids: [1, 4, 6, 9, 7, 22, 5] },
  { label: "WCQ (confederations)", ids: [29, 30, 31, 32, 33, 34, 37] },
  { label: "Continental clubs", ids: [13, 11, 12, 20, 17, 18] },
  { label: "Friendlies", ids: [10, 667, 1168] },
  { label: "Women", ids: [8, 743, 922, 525] },
];

let failed = 0;
for (const group of CHECKS) {
  for (const id of group.ids) {
    const row = byId(id);
    if (!row) {
      console.error(`Missing id ${id} (${group.label})`);
      failed++;
    }
  }
}

if (failed) {
  console.error(`\n${failed} id(s) not present in /leagues response – API catalogue may have changed.`);
  process.exit(1);
}

console.log(
  `OK – verified ${CHECKS.reduce((n, g) => n + g.ids.length, 0)} league id(s) against ${all.length} competitions in API-Football catalogue.`,
);
