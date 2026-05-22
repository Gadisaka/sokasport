/** API-Football and Prisma may disagree on number vs string for fixture ids. */
export function normalizeApiFixtureId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}
