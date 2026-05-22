import express from "express";
import {
  getFinancialSupportDashboard,
  getFinancialSupportReports,
} from "../controllers/financeController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

router.get(
  "/dashboard",
  authorizePermission("wallet:history"),
  authorizePermission("wallet:pending"),
  getFinancialSupportDashboard,
);

router.get(
  "/reports",
  authorizePermission("reports:read"),
  authorizePermission("wallet:history"),
  getFinancialSupportReports,
);

export default router;
