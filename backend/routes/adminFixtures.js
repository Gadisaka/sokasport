/**
 * Admin fixture operations.
 *
 * @module routes/adminFixtures
 */
import { Router } from "express";
import { authorizePermission } from "../middleware/auth.js";
import {
  getAdminFixturesSummary,
  listAdminFixtures,
  getAdminFixtureDetail,
  patchAdminFixtureMarketResults,
  overrideFixtureResult,
  unlockFixtureResult,
} from "../controllers/adminFixturesController.js";

const router = Router();
const readPerm = authorizePermission("games:read");
const writePerm = authorizePermission("games:override_result");

router.get("/summary", readPerm, getAdminFixturesSummary);
router.get("/", readPerm, listAdminFixtures);
router.get("/:id", readPerm, getAdminFixtureDetail);
router.patch("/:id/market-results", writePerm, patchAdminFixtureMarketResults);
router.post("/:id/result", writePerm, overrideFixtureResult);
router.post("/:id/unlock", writePerm, unlockFixtureResult);

export default router;
