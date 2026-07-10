/**
 * Builds backend/Config/leagueRanks.js from allowedLeagues + allLeaguesList.
 * Run: node backend/scripts/generateLeagueRanks.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  ALLOWED_LEAGUE_IDS,
  PREFERRED_LEAGUE_IDS,
  PRODUCT_PRIORITY_LEAGUE_IDS,
} from "../Config/allowedLeagues.js";
import { ALL_LEAGUE_IDS } from "../Config/allLeaguesList.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");
const allLeaguesPath = join(backendRoot, "Config", "allLeaguesList.js");
const outputPath = join(backendRoot, "Config", "leagueRanks.js");

/** @type {Map<number, { name: string, country: string }>} */
const meta = new Map();
const text = readFileSync(allLeaguesPath, "utf8");
for (const m of text.matchAll(/^\s*(\d+),\s*\/\/\s*(.+)$/gm)) {
  const id = Number(m[1]);
  const comment = m[2].trim();
  const paren = comment.lastIndexOf(" (");
  if (paren > 0 && comment.endsWith(")")) {
    meta.set(id, {
      name: comment.slice(0, paren),
      country: comment.slice(paren + 2, -1),
    });
  } else {
    meta.set(id, { name: comment, country: "Unknown" });
  }
}

const preferredOrder = [...PREFERRED_LEAGUE_IDS];
const productOrder = [...PRODUCT_PRIORITY_LEAGUE_IDS];
const allowedOrder = [...ALLOWED_LEAGUE_IDS].filter(
  (id) => !PREFERRED_LEAGUE_IDS.has(id) && !PRODUCT_PRIORITY_LEAGUE_IDS.has(id),
);
const remainder = [...ALL_LEAGUE_IDS]
  .filter(
    (id) =>
      !ALLOWED_LEAGUE_IDS.has(id) && !PRODUCT_PRIORITY_LEAGUE_IDS.has(id),
  )
  .map((id) => {
    const m = meta.get(id) ?? { name: "Unknown", country: "Unknown" };
    return { id, ...m };
  })
  .sort(
    (a, b) =>
      a.country.localeCompare(b.country, undefined, { sensitivity: "base" }) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

/** @type {Array<{ id: number, rank: number, label: string }>} */
const ranked = [];
let rank = 1;
for (const id of preferredOrder) {
  const m = meta.get(id) ?? { name: `League ${id}`, country: "Unknown" };
  ranked.push({
    id,
    rank,
    label: `${m.name} (${m.country})`,
  });
  rank++;
}
for (const id of productOrder) {
  const m = meta.get(id) ?? { name: `League ${id}`, country: "Unknown" };
  ranked.push({
    id,
    rank,
    label: `${m.name} (${m.country})`,
  });
  rank++;
}
for (const id of allowedOrder) {
  const m = meta.get(id) ?? { name: `League ${id}`, country: "Unknown" };
  ranked.push({
    id,
    rank,
    label: `${m.name} (${m.country})`,
  });
  rank++;
}
for (const row of remainder) {
  ranked.push({
    id: row.id,
    rank,
    label: `${row.name} (${row.country})`,
  });
  rank++;
}

function escapeComment(text) {
  return String(text).replace(/\*\//g, "*\\/");
}

const mapLines = ranked.map(
  (r) => `  [${r.id}, ${r.rank}], // ${escapeComment(r.label)}`,
);

const generatedAt = new Date().toISOString();
const fileContent = `/**
 * League priority ranks (1 = highest). Generated from allowedLeagues + allLeaguesList.
 * Generated: ${generatedAt}. Re-run generateLeagueRanks.mjs after catalogue edits.
 */

import {
  PREFERRED_LEAGUE_IDS,
  PRODUCT_PRIORITY_LEAGUE_IDS,
} from "./allowedLeagues.js";

export const TOP_LEAGUE_RANK_THRESHOLD = ${preferredOrder.length};
export const DEFAULT_RANK = 9999;
export const LEGACY_ALLOWLIST_MAX = ${ALLOWED_LEAGUE_IDS.size};

/** @type {Map<number, number>} api_league_id → rank (1 = elite) */
export const LEAGUE_RANK_BY_ID = new Map([
${mapLines.join("\n")}
]);

/**
 * @param {number|null|undefined} apiLeagueId
 * @returns {number}
 */
export function getLeagueRank(apiLeagueId) {
  if (apiLeagueId == null || !Number.isFinite(Number(apiLeagueId))) {
    return DEFAULT_RANK;
  }
  const r = LEAGUE_RANK_BY_ID.get(Number(apiLeagueId));
  return Number.isFinite(r) ? r : DEFAULT_RANK;
}

/**
 * @param {number|null|undefined} apiLeagueId
 */
export function isTopLeague(apiLeagueId) {
  if (apiLeagueId == null) return false;
  const id = Number(apiLeagueId);
  if (PREFERRED_LEAGUE_IDS.has(id)) return true;
  if (PRODUCT_PRIORITY_LEAGUE_IDS.has(id)) return true;
  return getLeagueRank(id) <= TOP_LEAGUE_RANK_THRESHOLD;
}

/**
 * Pick up to \`cap\` league ids with the best (lowest) rank.
 * @param {Iterable<number>} activeIds
 * @param {number} cap
 * @returns {Set<number>}
 */
export function pickTopActiveLeagues(activeIds, cap) {
  const limit = Math.max(0, Math.floor(Number(cap) || 0));
  if (limit === 0) return new Set();
  const sorted = [...activeIds]
    .filter((id) => Number.isFinite(Number(id)))
    .sort((a, b) => getLeagueRank(a) - getLeagueRank(b) || a - b);
  return new Set(sorted.slice(0, limit));
}

function envPositiveInt(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Max leagues to ingest per bulk sync (top active by rank). */
export function getIngestActiveCap() {
  return envPositiveInt("INGEST_ACTIVE_CAP", 200);
}

/** Max non-top leagues in sidebar catalog (top section is separate). */
export function getSidebarActiveCap() {
  return envPositiveInt("SIDEBAR_ACTIVE_CAP", 200);
}
`;

writeFileSync(outputPath, fileContent, "utf8");
console.log(`Wrote ${outputPath} (${ranked.length} ranked leagues)`);
