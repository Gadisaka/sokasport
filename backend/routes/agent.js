import express from "express";
import {
  getAgentCashierWalletActivity,
  getAgentCashiers,
  getAgentDashboard,
  getAgentReports,
} from "../controllers/agentController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

router.get("/dashboard", authorizePermission("dashboard:read"), getAgentDashboard);
router.get("/cashiers", authorizePermission("cashiers:read"), getAgentCashiers);
router.get("/reports", authorizePermission("reports:read"), getAgentReports);
router.get(
  "/cashier-wallet-activity",
  authorizePermission("cashiers:read"),
  getAgentCashierWalletActivity,
);

export default router;
