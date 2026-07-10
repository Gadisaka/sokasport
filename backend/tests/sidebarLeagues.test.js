import assert from "node:assert/strict";
import test from "node:test";
import {
  getLeagueRank,
  isTopLeague,
  pickTopActiveLeagues,
} from "../Config/leagueRanks.js";

/** Mirrors GET /sidebar-leagues catalog id selection. */
function buildSidebarCatalogIds(activeIds, sidebarCap) {
  const active = new Set(activeIds);
  const topActive = [...active].filter((id) => isTopLeague(id));
  const regionalCandidates = [...active].filter((id) => !isTopLeague(id));
  const regionalPicked = pickTopActiveLeagues(regionalCandidates, sidebarCap);
  return [...new Set([...topActive, ...regionalPicked])];
}

test("sidebar catalog is active-only and includes all active top leagues", () => {
  const active = [39, 140, 500, 600];
  const ids = buildSidebarCatalogIds(active, 1);
  assert.ok(ids.includes(39));
  assert.ok(ids.includes(140));
  assert.equal(ids.filter((id) => !isTopLeague(id)).length, 1);
});

test("sidebar regional cap fills with next-best rank when top leagues inactive", () => {
  const active = [94, 88, 113];
  const ids = buildSidebarCatalogIds(active, 2);
  assert.deepEqual(
    [...ids].sort((a, b) => getLeagueRank(a) - getLeagueRank(b)),
    [94, 88],
  );
});

test("active ethiopia leagues are top-section catalog entries", () => {
  const ids = buildSidebarCatalogIds([363, 1228, 244, 1], 10);
  assert.ok(ids.includes(363));
  assert.ok(ids.includes(1228));
  assert.ok(isTopLeague(363));
  assert.ok(isTopLeague(1228));
});
