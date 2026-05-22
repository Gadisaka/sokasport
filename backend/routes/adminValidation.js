import express from "express";
import { authorizePermission } from "../middleware/auth.js";
import {
  forceLiveFixtureResync,
  getLiveOddsMonitor,
  getPlacementValidationLogs,
  getValidationMetrics,
  getTicketValidationMonitor,
  setLiveMarketState,
} from "../controllers/adminValidationController.js";

const router = express.Router();

router.get(
  "/live-odds",
  authorizePermission("tickets:read"),
  getLiveOddsMonitor,
);
router.get(
  "/tickets",
  authorizePermission("tickets:read"),
  getTicketValidationMonitor,
);
router.get(
  "/metrics",
  authorizePermission("tickets:read"),
  getValidationMetrics,
);
router.get(
  "/placement-logs",
  authorizePermission("tickets:read"),
  getPlacementValidationLogs,
);
router.post(
  "/live-odds/:apiFixtureId/resync",
  authorizePermission("tickets:write"),
  forceLiveFixtureResync,
);
router.patch(
  "/live-odds/:apiFixtureId/market-state",
  authorizePermission("tickets:write"),
  setLiveMarketState,
);

export default router;
