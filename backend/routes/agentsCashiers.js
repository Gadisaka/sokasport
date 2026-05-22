import express from "express";
import {
  listCashiers,
  getCashier,
  createCashier,
  updateCashier,
  deleteCashier,
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  assignAgentToCashier,
  unassignAgentFromCashier,
  listAssignableCashiers,
} from "../controllers/agentsCashiersController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

// Cashiers
router.get("/cashiers", authorizePermission("agents-cashiers:read"), listCashiers);
router.get("/cashiers/:id", authorizePermission("agents-cashiers:read"), getCashier);
router.post("/cashiers", authorizePermission("users:create"), createCashier);
router.put("/cashiers/:id", authorizePermission("users:update"), updateCashier);
router.delete("/cashiers/:id", authorizePermission("users:update"), deleteCashier);

// Agents
router.get("/agents", authorizePermission("agents-cashiers:read"), listAgents);
router.post("/agents", authorizePermission("users:create"), createAgent);
router.put("/agents/:id", authorizePermission("users:update"), updateAgent);
router.delete("/agents/:id", authorizePermission("users:update"), deleteAgent);

// Assignment (agents ↔ cashiers)
router.get(
  "/assignable-cashiers",
  authorizePermission("agents-cashiers:read"),
  listAssignableCashiers,
);
router.post("/assign", authorizePermission("agents-cashiers:assign"), assignAgentToCashier);
router.delete(
  "/assign/:cashierProfileId",
  authorizePermission("agents-cashiers:assign"),
  unassignAgentFromCashier,
);

export default router;
