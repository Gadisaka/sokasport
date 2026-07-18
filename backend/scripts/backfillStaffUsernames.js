#!/usr/bin/env node
/**
 * Migrate users collection for staff username + fullname:
 * 1. Rename MongoDB field `name` → `fullname` on all users
 * 2. Assign unique `username` to every non-PLAYER user that lacks one
 *
 * Run with:
 *   node backend/scripts/backfillStaffUsernames.js          (dry run)
 *   node backend/scripts/backfillStaffUsernames.js --apply  (write)
 *
 * Requires DATABASE_URL. Safe to re-run (skips users that already have username).
 */

import { prisma } from "../Config/db.js";
import { suggestUsernameFromUser } from "../lib/username.js";
import { unsetUserFields } from "../lib/sparseUserFields.js";

const APPLY = process.argv.includes("--apply");

async function renameNameToFullname() {
  // MongoDB $rename is idempotent when `name` is already gone.
  const result = await prisma.$runCommandRaw({
    update: "users",
    updates: [
      {
        q: { name: { $exists: true } },
        u: { $rename: { name: "fullname" } },
        multi: true,
      },
    ],
  });
  console.log(
    `[backfill-usernames] rename name→fullname: n=${result?.n ?? "?"} nModified=${result?.nModified ?? "?"}`,
  );
}

async function allocateUniqueUsername(base, taken) {
  let candidate = base.slice(0, 32);
  if (!taken.has(candidate)) return candidate;
  for (let i = 2; i < 10_000; i += 1) {
    const suffix = `_${i}`;
    const truncated = base.slice(0, Math.max(1, 32 - suffix.length));
    candidate = `${truncated}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not allocate unique username for base=${base}`);
}

async function backfillStaffUsernames() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      fullname: true,
      email: true,
      phone: true,
      role: { select: { name: true } },
    },
  });

  const taken = new Set(
    users.map((u) => u.username).filter((u) => typeof u === "string" && u),
  );

  let updated = 0;
  let skipped = 0;

  for (const user of users) {
    if (user.role?.name === "PLAYER") {
      if (user.username) {
        console.warn(
          `[backfill-usernames] PLAYER ${user.id} has username=${user.username} — clearing`,
        );
        if (APPLY) {
          // $unset — never write username:null (breaks sparse unique index).
          await unsetUserFields(prisma, user.id, ["username"]);
        }
        taken.delete(user.username);
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    if (user.username) {
      skipped += 1;
      continue;
    }

    const base = suggestUsernameFromUser(user);
    const username = await allocateUniqueUsername(base, taken);
    taken.add(username);

    console.log(
      `[backfill-usernames] ${APPLY ? "SET" : "WOULD_SET"} ${user.email} → ${username} (${user.role?.name})`,
    );

    if (APPLY) {
      await prisma.user.update({
        where: { id: user.id },
        data: { username },
      });
    }
    updated += 1;
  }

  console.log(
    `[backfill-usernames] staff username pass done: updated=${updated} skipped=${skipped} mode=${APPLY ? "APPLY" : "DRY_RUN"}`,
  );
}

async function run() {
  console.log(
    `[backfill-usernames] mode=${APPLY ? "APPLY" : "DRY_RUN"}`,
  );

  if (APPLY) {
    await renameNameToFullname();
  } else {
    console.log(
      "[backfill-usernames] dry run skips Mongo $rename; pass --apply to rename name→fullname",
    );
  }

  await backfillStaffUsernames();
}

run()
  .catch((err) => {
    console.error("[backfill-usernames] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
