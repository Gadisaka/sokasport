import express from "express";
import { sendAdminNotification } from "../controllers/notificationsController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

router.post("/send", authorizePermission("cms:write"), sendAdminNotification);

export default router;
