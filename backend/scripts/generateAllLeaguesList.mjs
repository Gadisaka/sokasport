/**
 * Fetches the full API-Football /leagues catalogue and writes
 * backend/Config/allLeaguesList.js.
 *
 * Run from repo root: `node backend/scripts/generateAllLeaguesList.mjs`
 * Requires `API_FOOTBALL_KEY` in `backend/.env`.
 */
import axios from "axios";
import { config as loadEnv } from "dotenv";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ALLOWED_LEAGUE_IDS } from "../Config/allowedLeagues.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");
loadEnv({ path: join(backendRoot, ".env") });
process.chdir(backendRoot);

const OUTPUT_PATH = join(backendRoot, "Config", "allLeaguesList.js");

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

const rawRows = data.response ?? [];

/** @type {Map<number, { id: number, name: string, country: string }>} */
const byId = new Map();
for (const entry of rawRows) {
  const id = entry.league?.id;
  if (!Number.isFinite(id)) continue;
  if (byId.has(id)) continue;
  byId.set(id, {
    id,
    name: entry.league?.name ?? "Unknown",
    country: entry.country?.name ?? "Unknown",
  });
}

/** @type {Map<string, Array<{ id: number, name: string, country: string }>>} */
const byCountry = new Map();
for (const league of byId.values()) {
  const list = byCountry.get(league.country) ?? [];
  list.push(league);
  byCountry.set(league.country, list);
}

const countries = [...byCountry.keys()].sort((a, b) =>
  a.localeCompare(b, undefined, { sensitivity: "base" }),
);

function escapeComment(text) {
  return String(text).replace(/\*\//g, "*\\/");
}

function formatSection(country, leagues) {
  const sorted = [...leagues].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  const lines = [
    "  // ─────────────────────────────────────────────────────────────────────────",
    `  // ${country.toUpperCase()}`,
    "  // ─────────────────────────────────────────────────────────────────────────",
  ];
  for (const lg of sorted) {
    lines.push(`  ${lg.id}, // ${escapeComment(lg.name)} (${escapeComment(lg.country)})`);
  }
  return lines.join("\n");
}

const bodySections = countries.map((country) =>
  formatSection(country, byCountry.get(country)),
);
const generatedAt = new Date().toISOString();

const fileContent = `/**
 * Full API-Football league catalogue (generated from GET /v3/leagues).
 * Generated: ${generatedAt}. Do not edit by hand — re-run generateAllLeaguesList.mjs.
 * NOT connected to ingestion or public routes yet.
 */

export const ALL_LEAGUE_IDS = new Set([
${bodySections.join("\n\n")}
]);

/**
 * Quick membership check against the full upstream catalogue.
 * @param {number} leagueId API-Football league.id
 */
export function isAllLeague(leagueId) {
  return ALL_LEAGUE_IDS.has(leagueId);
}
`;

writeFileSync(OUTPUT_PATH, fileContent, "utf8");

const allIds = new Set(byId.keys());
const allowedCount = ALLOWED_LEAGUE_IDS.size;
const missingFromApi = [...ALLOWED_LEAGUE_IDS].filter((id) => !allIds.has(id));
const notInAllowlist = [...allIds].filter((id) => !ALLOWED_LEAGUE_IDS.has(id));

console.log(`Wrote ${OUTPUT_PATH}`);
console.log(`Raw /leagues rows:     ${rawRows.length}`);
console.log(`Unique league IDs:     ${allIds.size}`);
console.log(`Current allowlist:     ${allowedCount}`);
console.log(`New vs allowlist:      ${notInAllowlist.length}`);
console.log(`Allowlist missing API: ${missingFromApi.length}`);
if (missingFromApi.length) {
  console.error("Allowlist IDs not in API:", missingFromApi.join(", "));
  process.exit(1);
}
