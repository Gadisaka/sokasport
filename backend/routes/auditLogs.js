import express from "express";
import { listAuditLogs } from "../controllers/auditLogsController.js";
import { authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authorizeRoles("SUPER_ADMIN", "ADMIN"), listAuditLogs);

export default router;
