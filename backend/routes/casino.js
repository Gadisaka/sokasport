import express from "express";
import { createInoutLaunch } from "../controllers/inoutLaunchController.js";

const router = express.Router();

// Authenticated at mount time (see index.js). Player-only enforced in controller.
router.post("/inout/launch", createInoutLaunch);

export default router;
