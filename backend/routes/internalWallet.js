/**
 * Internal (server-to-server) wallet routes for MRX.
 * Protected by x-api-key — do NOT mount behind JWT middleware.
 *
 * @module routes/internalWallet
 */
import express from "express";
import { adjustBalance } from "../controllers/internalWalletController.js";
import { verifyInternalBridgeKey } from "../middleware/internalBridgeAuth.js";

const router = express.Router();

router.post("/adjust-balance", verifyInternalBridgeKey, adjustBalance);

export default router;
