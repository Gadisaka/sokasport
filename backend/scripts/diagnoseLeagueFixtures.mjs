#!/usr/bin/env node
/**
 * Compare API-Football fixtures vs MongoDB + odds for one league/date.
 *
 * Usage (from backend/):
 *   node scripts/diagnoseLeagueFixtures.mjs [apiLeagueId] [YYYY-MM-DD]
 *
 * Example:
 *   node scripts/diagnoseLeagueFixtures.mjs 363 2026-06-14
 */
import dotenv from "dotenv";
import prisma from "../Config/db.js";
import { api } from "../services/apiSportsService.js";
import { buildOddsParseOptions } from "../Config/oddsFilters.js";
import { parseMarkets } from "../utils/oddsParser.js";
import { getPreferredBookmakerApiId } from "../services/settingsService.js";

dotenv.config();

const leagueId = Number.parseInt(process.argv[2] || "363", 10);
const date =
  process.argv[3] || new Date().toISOString().slice(0, 10);

if (!Number.isFinite(leagueId)) {
  console.error("Invalid league id");
  process.exit(1);
}

const preferredApiId = await getPreferredBookmakerApiId();
const parseOptions = buildOddsParseOptions(preferredApiId);

console.log(
  `[diagnose] league=${leagueId} date=${date} preferredBookmaker=${preferredApiId ?? "—"}`,
);
console.log(
  `[diagnose] parse chain: ${parseOptions.orderedBookmakerApiIds?.join(">") ?? "all bookmakers"}`,
);

const upstream = await api("football").getFixturesByDate(date);
const apiRows = upstream.filter((e) => e.league?.id === leagueId);

console.log(`\nAPI-Football: ${apiRows.length} fixture(s)`);

for (const entry of apiRows) {
  const apiFixtureId = entry.fixture?.id;
  const label = `${entry.teams?.home?.name} vs ${entry.teams?.away?.name}`;
  const db = await prisma.fixture.findUnique({
    where: { api_fixture_id: apiFixtureId },
    include: {
      markets: {
        include: {
          odd_lines: { include: { bookmaker: true } },
        },
      },
    },
  });

  let parsePreview = "—";
  try {
    const rawOdds = await api("football").getOdds(apiFixtureId);
    const parsed = parseMarkets(rawOdds, parseOptions);
    parsePreview =
      parsed.bookmakers.length > 0
        ? `would persist bk=${parsed.bookmakers[0].apiBookmakerId} mkts=${parsed.bookmakers[0].markets.length}`
        : "parse empty (no chain match)";
  } catch (err) {
    parsePreview = `odds fetch error: ${err?.message || err}`;
  }

  const dbMkts = db?.markets?.length ?? 0;
  const dbLines = db?.markets?.reduce(
    (n, m) => n + (m.odd_lines?.length || 0),
    0,
  );

  console.log(
    `\n  ${apiFixtureId} ${entry.fixture?.date} ${label}`,
  );
  console.log(`    DB: ${db ? "yes" : "MISSING"} markets=${dbMkts} lines=${dbLines ?? 0}`);
  console.log(`    Sync preview: ${parsePreview}`);
}

await prisma.$disconnect();
