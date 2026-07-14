#!/usr/bin/env node
/**
 * CLI wrapper to sync the InOut game catalog on demand.
 *
 * Run inside the backend container:
 *   docker compose exec backend node scripts/syncInoutCatalog.mjs
 *
 * Requires INOUT_OPERATOR_ID to be set in the environment.
 */
import { prisma } from "../Config/db.js";
import syncInoutCatalog from "../jobs/syncInoutCatalog.js";

syncInoutCatalog()
  .then((r) => {
    console.log(
      `Done. total=${r.total} created=${r.created} updated=${r.updated}`,
    );
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
