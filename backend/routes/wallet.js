import express from "express";
import {
  approveRequest,
  deductWallet,
  fillWallet,
  getGlobalWalletHistory,
  getWalletHistory,
  holdRequest,
  listWallets,
  listPendingRequests,
  rejectRequest,
} from "../controllers/walletController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

// Static paths first to avoid `:walletId` param capturing "pending" / "requests"
router.get("/pending", authorizePermission("wallet:pending"), listPendingRequests);
router.get("/wallets", authorizePermission("wallet:history"), listWallets);
router.get("/history", authorizePermission("wallet:history"), getGlobalWalletHistory);
router.patch("/requests/:id/approve", authorizePermission("wallet:approve"), approveRequest);
router.patch("/requests/:id/reject", authorizePermission("wallet:reject"), rejectRequest);
router.patch("/requests/:id/hold", authorizePermission("wallet:hold"), holdRequest);

router.post("/:walletId/fill", authorizePermission("wallet:fill"), fillWallet);
router.post("/:walletId/deduct", authorizePermission("wallet:deduct"), deductWallet);
router.get("/:walletId/history", authorizePermission("wallet:history"), getWalletHistory);

export default router;
