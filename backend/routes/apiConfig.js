import express from "express";
import {
  getBookmakerPreference,
  listBookmakerSamples,
  listBookmakers,
  putBookmakerPreference,
  refreshOddsNow,
  syncBookmakersFromUpstream,
} from "../controllers/apiConfigController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

// Reads are gated on settings:read (SUPER_ADMIN + ADMIN), writes on
// settings:update which only SUPER_ADMIN has in practice (ADMIN falls back
// to settings:write in the permission map, but the route requires the
// stricter :update scope to match the rest of /api/admin/settings).
router.get(
  "/bookmakers",
  authorizePermission("settings:read"),
  listBookmakers,
);
router.get("/samples", authorizePermission("settings:read"), listBookmakerSamples);
router.get(
  "/bookmaker-preference",
  authorizePermission("settings:read"),
  getBookmakerPreference,
);
router.put(
  "/bookmaker-preference",
  authorizePermission("settings:update"),
  putBookmakerPreference,
);
router.post(
  "/refresh-odds",
  authorizePermission("settings:update"),
  refreshOddsNow,
);
router.post(
  "/sync-bookmakers",
  authorizePermission("settings:update"),
  syncBookmakersFromUpstream,
);

export default router;
