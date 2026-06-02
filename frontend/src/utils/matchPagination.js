import { groupMatchesByLeague } from "./matchDisplaySort.js";

export const MATCHES_PER_PAGE = 50;

/** Flatten grouped league rows in display order. */
export function flattenGroupedMatches(groupedEntries) {
  const flat = [];
  for (const [, leagueMatches] of groupedEntries || []) {
    for (const m of leagueMatches) flat.push(m);
  }
  return flat;
}

/**
 * @param {[string, object[]][]} groupedEntries
 * @param {number} pageIndex — zero-based
 */
export function paginateGroupedMatches(groupedEntries, pageIndex) {
  const flat = flattenGroupedMatches(groupedEntries);
  const totalMatches = flat.length;
  const totalPages = Math.max(1, Math.ceil(totalMatches / MATCHES_PER_PAGE));
  const page = Math.min(Math.max(0, pageIndex), totalPages - 1);
  const start = page * MATCHES_PER_PAGE;
  const slice = flat.slice(start, start + MATCHES_PER_PAGE);

  return {
    grouped: groupMatchesByLeague(slice),
    page,
    totalPages,
    totalMatches,
    pageSize: MATCHES_PER_PAGE,
    isFirstPage: page === 0,
    isLastPage: page >= totalPages - 1,
    showPagination: totalMatches > MATCHES_PER_PAGE,
  };
}
