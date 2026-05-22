import express from "express";
import {
  getBonus,
  listBonuses,
  updateBonus,
} from "../controllers/bonusController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authorizePermission("settings:read"), listBonuses);
router.get("/:id", authorizePermission("settings:read"), getBonus);
router.patch("/:id", authorizePermission("settings:update"), updateBonus);

export default router;
