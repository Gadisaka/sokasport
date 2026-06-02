import { describe, expect, it } from "vitest";
import { groupMatchesByLeague } from "./matchDisplaySort.js";
import {
  MATCHES_PER_PAGE,
  paginateGroupedMatches,
} from "./matchPagination.js";

describe("paginateGroupedMatches", () => {
  it("returns one page when at or below page size", () => {
    const matches = Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`,
      league: "England - Premier League",
      kickoffAt: new Date(2026, 5, 1, 12 + i).toISOString(),
    }));
    const grouped = groupMatchesByLeague(matches);
    const result = paginateGroupedMatches(grouped, 0);
    expect(result.totalMatches).toBe(30);
    expect(result.totalPages).toBe(1);
    expect(result.showPagination).toBe(false);
    expect(result.isLastPage).toBe(true);
    expect(result.grouped[0][1]).toHaveLength(30);
  });

  it("splits into pages of 50 and marks last page", () => {
    const matches = Array.from({ length: 120 }, (_, i) => ({
      id: `m${i}`,
      league: i < 60 ? "England - Premier League" : "Spain - La Liga",
      kickoffAt: new Date(2026, 5, 1, 10, i % 60).toISOString(),
    }));
    const grouped = groupMatchesByLeague(matches);
    const page0 = paginateGroupedMatches(grouped, 0);
    const page1 = paginateGroupedMatches(grouped, 1);
    const page2 = paginateGroupedMatches(grouped, 2);
    expect(page0.showPagination).toBe(true);
    expect(page0.isLastPage).toBe(false);
    expect(page1.isLastPage).toBe(false);
    expect(page2.isLastPage).toBe(true);
    const flat0 = page0.grouped.flatMap(([, rows]) => rows);
    const flat2 = page2.grouped.flatMap(([, rows]) => rows);
    expect(flat0).toHaveLength(MATCHES_PER_PAGE);
    expect(flat2).toHaveLength(20);
  });
});
