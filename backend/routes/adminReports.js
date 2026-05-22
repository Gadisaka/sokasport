import express from "express";
import { getAdminSalesReports } from "../controllers/adminReportsController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

router.get("/sales", authorizePermission("reports:read"), getAdminSalesReports);

export default router;
