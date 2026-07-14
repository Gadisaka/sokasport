import express from "express";
import {
  inoutRawBodyParser,
  verifyInoutWebhook,
} from "../middleware/inoutWebhook.js";
import { handleInoutWebhook } from "../controllers/inoutWebhookController.js";

const router = express.Router();

// Raw body parser + signature verification run before the handler. This router
// MUST be mounted before the global `express.json()` so the raw bytes are
// preserved for HMAC verification.
router.post("/webhook", inoutRawBodyParser, verifyInoutWebhook, handleInoutWebhook);

export default router;
