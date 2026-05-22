import express from "express";
import {
  cashierDeposit,
  getWithdrawRequest,
  approveWithdrawRequest,
  getCashierHistory,
  previewShopWithdraw,
  redeemShopWithdraw,
} from "../controllers/cashierWalletController.js";
import { getCashierDashboardStats } from "../controllers/cashierDashboardController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

router.get("/dashboard-stats", authorizePermission("tickets:read"), getCashierDashboardStats);
router.post("/deposit", authorizePermission("wallet:deposit"), cashierDeposit);
router.post("/shop-withdraw/preview", authorizePermission("wallet:withdraw"), previewShopWithdraw);
router.post("/shop-withdraw/redeem", authorizePermission("wallet:withdraw"), redeemShopWithdraw);
router.get("/withdraw-request", authorizePermission("wallet:withdraw"), getWithdrawRequest);
router.patch("/withdraw-request/:id/approve", authorizePermission("wallet:withdraw"), approveWithdrawRequest);
router.get("/history", authorizePermission("wallet:history"), getCashierHistory);

export default router;
