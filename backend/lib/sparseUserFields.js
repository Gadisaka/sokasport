/**
 * Mongo sparse-unique helpers for optional User fields (`username`, `phone`).
 *
 * Sparse unique indexes skip **missing** fields but still index documents where
 * the field is present as `null`. Writing `null` therefore blocks every later
 * row that also stores null. Prefer omitting the field on create, and `$unset`
 * on clear — never persist `null` for these columns.
 *
 * @module lib/sparseUserFields
 */

/**
 * Remove one or more optional fields from a user document (Mongo `$unset`).
 *
 * @param {{ $runCommandRaw: Function }} db  Prisma client (or compatible)
 * @param {string} userId
 * @param {string[]} fields
 */
export async function unsetUserFields(db, userId, fields) {
  const list = (Array.isArray(fields) ? fields : []).filter(Boolean);
  if (!userId || list.length === 0) return;

  const unset = {};
  for (const field of list) unset[field] = "";

  await db.$runCommandRaw({
    update: "users",
    updates: [
      {
        q: { _id: userId },
        u: { $unset: unset },
        multi: false,
      },
    ],
  });
}

/**
 * Whether a Prisma P2002 unique-violation mentions a given field/index name.
 *
 * @param {unknown} error
 * @param {string} field
 * @returns {boolean}
 */
export function uniqueViolationMentions(error, field) {
  const target = error?.meta?.target;
  if (Array.isArray(target)) {
    return target.some((t) => String(t).includes(field));
  }
  if (typeof target === "string") return target.includes(field);
  return false;
}
