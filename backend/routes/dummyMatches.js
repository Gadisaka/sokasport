import { Router } from "express";
import dummyMatches from "../data/dummyMatches.js";

const router = Router();

router.get("/matches", (_req, res) => {
  res.json({ matches: dummyMatches });
});

router.get("/matches/:id", (req, res) => {
  const match = dummyMatches.find((m) => m.id === req.params.id);
  if (!match) {
    return res.status(404).json({ message: "Match not found" });
  }
  res.json({ match });
});

export default router;
