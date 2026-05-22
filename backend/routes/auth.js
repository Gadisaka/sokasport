import express from "express";
import {
  changePassword,
  getMe,
  login,
  patchProfile,
  verifyPassword,
} from "../controllers/authController.js";
import { register } from "../controllers/playerController.js";
import { authenticateToken } from "../middleware/auth.js";
import { createSportsbookRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();
const cashierLoginRateLimit = createSportsbookRateLimiter("cashier_login");

router.post("/login", cashierLoginRateLimit, login);
router.post("/register", register);
router.get("/me", authenticateToken, getMe);
router.patch("/profile", authenticateToken, patchProfile);
router.post("/verify-password", authenticateToken, verifyPassword);
router.patch("/change-password", authenticateToken, changePassword);

export default router;
