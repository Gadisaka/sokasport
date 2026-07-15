import express from "express";
import {
  createUser,
  deleteUser,
  getUsersMeta,
  listUsers,
  updateUser,
} from "../controllers/usersController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authorizePermission("users:read"), listUsers);
router.get("/meta", authorizePermission("users:read"), getUsersMeta);
router.post("/", authorizePermission("users:create"), createUser);
router.put("/:id", authorizePermission("users:update"), updateUser);
router.delete("/:id", authorizePermission("users:update"), deleteUser);

export default router;
