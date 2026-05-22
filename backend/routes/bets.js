import express from "express";
import {
  createPrebookTicket,
  validatePrebookTicket,
} from "../controllers/ticketsController.js";
import { listActiveBonusesPublic } from "../controllers/bonusController.js";
import { optionalAuthenticateToken } from "../middleware/auth.js";
import { createSportsbookRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

router.get("/bonuses/active", listActiveBonusesPublic);

// Public sportsbook booking endpoint (no auth required).
router.post(
  "/validate",
  optionalAuthenticateToken,
  createSportsbookRateLimiter("bets_validate"),
  validatePrebookTicket,
);
router.post(
  "/place",
  optionalAuthenticateToken,
  createSportsbookRateLimiter("bets_place"),
  createPrebookTicket,
);

export default router;
