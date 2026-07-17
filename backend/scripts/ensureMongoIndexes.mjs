#!/usr/bin/env node
/**
 * Ensure Mongo indexes that `prisma db push` cannot create safely.
 *
 * Root cause: optional login fields (`username`, `phone`) must allow many
 * missing values (players have no username; staff may have no phone). Prisma
 * `@unique` on optional Mongo fields builds a non-sparse unique index that
 * rejects multiple nulls — so those fields are NOT `@unique` in schema.prisma.
 * Uniqueness is still enforced here with sparse unique indexes.
 *
 * Also creates:
 *   - fixtures.next_odds_check_at (odds horizon eligibility)
 *   - InOut session/game indexes
 *
 * Run AFTER `prisma db push` (push may drop unmanaged indexes).
 *
 * Usage (from backend/):
 *   npm run db:ensure-indexes
 *
 * Docker:
 *   docker compose -f docker-compose.prod.yml exec backend npx prisma db push
 *   docker compose -f docker-compose.prod.yml exec backend npm run db:ensure-indexes
 *   docker compose -f docker-compose.prod.yml restart worker
 */
import "dotenv/config";
import { prisma } from "../Config/db.js";

function indexEntries(raw) {
  if (Array.isArray(raw?.cursor?.firstBatch)) return raw.cursor.firstBatch;
  if (Array.isArray(raw?.indexes)) return raw.indexes;
  return [];
}

async function listIndexes(collection) {
  const raw = await prisma.$runCommandRaw({ listIndexes: collection });
  return indexEntries(raw);
}

async function dropIndexIfExists(collection, name) {
  const indexes = await listIndexes(collection);
  if (!indexes.some((idx) => idx.name === name)) return false;
  try {
    await prisma.$runCommandRaw({ dropIndexes: collection, index: name });
    console.log(`[ensure-indexes] dropped ${collection}.${name}`);
    return true;
  } catch (err) {
    // IndexNotFound is fine under races.
    if (String(err?.message || err).includes("IndexNotFound")) return false;
    throw err;
  }
}

async function createIndex(collection, keys, options) {
  const existing = await listIndexes(collection);
  const sameName = existing.find((idx) => idx.name === options.name);
  if (sameName) {
    const sameKeys =
      JSON.stringify(sameName.key ?? {}) === JSON.stringify(keys);
    const sparseOk = Boolean(sameName.sparse) === Boolean(options.sparse);
    const uniqueOk = Boolean(sameName.unique) === Boolean(options.unique);
    if (sameKeys && sparseOk && uniqueOk) {
      console.log(
        `[ensure-indexes] ok ${collection}.${options.name} (already present)`,
      );
      return;
    }
    console.warn(
      `[ensure-indexes] recreating ${collection}.${options.name} (options differ)`,
    );
    await dropIndexIfExists(collection, options.name);
  }

  await prisma.$runCommandRaw({
    createIndexes: collection,
    indexes: [
      {
        key: keys,
        name: options.name,
        ...(options.unique ? { unique: true } : {}),
        ...(options.sparse ? { sparse: true } : {}),
      },
    ],
  });
  console.log(
    `[ensure-indexes] created ${collection}.${options.name}` +
      `${options.unique ? " unique" : ""}` +
      `${options.sparse ? " sparse" : ""}`,
  );
}

async function unsetNullOrEmpty(collection, field) {
  const result = await prisma.$runCommandRaw({
    update: collection,
    updates: [
      {
        q: {
          $or: [{ [field]: null }, { [field]: "" }],
        },
        u: { $unset: { [field]: "" } },
        multi: true,
      },
    ],
  });
  const n = Number(result?.n ?? result?.nModified ?? 0);
  console.log(
    `[ensure-indexes] unset null/empty ${collection}.${field}: ${n} docs`,
  );
  return n;
}

async function run() {
  console.log("[ensure-indexes] starting…");

  // Players have no username; staff-only. Nulls must not exist as a field
  // value or sparse unique still indexes them.
  await unsetNullOrEmpty("users", "username");
  await unsetNullOrEmpty("users", "phone");

  // Prisma expected names for User @unique optional fields.
  await createIndex(
    "users",
    { username: 1 },
    { name: "users_username_key", unique: true, sparse: true },
  );
  await createIndex(
    "users",
    { phone: 1 },
    { name: "users_phone_key", unique: true, sparse: true },
  );

  // Odds adaptive eligibility (from odds horizon overhaul).
  await createIndex(
    "fixtures",
    { next_odds_check_at: 1 },
    { name: "fixtures_next_odds_check_at_idx" },
  );

  // InOut indexes Prisma tried to add in the same failed push.
  await createIndex(
    "inout_game_sessions",
    { token: 1 },
    { name: "inout_game_sessions_token_key", unique: true },
  );
  await createIndex(
    "inout_game_sessions",
    { user_id: 1 },
    { name: "inout_game_sessions_user_id_idx" },
  );
  await createIndex(
    "inout_games",
    { game_mode: 1 },
    { name: "inout_games_game_mode_key", unique: true },
  );
  await createIndex(
    "inout_games",
    { enabled: 1 },
    { name: "inout_games_enabled_idx" },
  );

  console.log("[ensure-indexes] done");
}

run()
  .catch((err) => {
    console.error("[ensure-indexes] fatal:", err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
