import express from "express";
import { getAdminDashboardInsights } from "../controllers/adminInsightsController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

router.get(
  "/dashboard",
  authorizePermission("users:read"),
  authorizePermission("tickets:read"),
  authorizePermission("wallet:history"),
  getAdminDashboardInsights,
);

export default router;
