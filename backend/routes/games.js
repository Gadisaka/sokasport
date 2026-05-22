import express from "express";
import {
  bulkUpsertOdds,
  createLeague,
  createMatch,
  createOdd,
  createSport,
  getMatch,
  listLeagues,
  listMatches,
  listOdds,
  listSports,
  overrideMatchResult,
  updateLeague,
  updateMatch,
  updateMatchStatus,
  updateOdd,
  updateSport,
} from "../controllers/gameController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

// Sports
router.get("/sports", authorizePermission("games:read"), listSports);
router.post("/sports", authorizePermission("games:manage"), createSport);
router.put("/sports/:id", authorizePermission("games:manage"), updateSport);

// Leagues
router.get("/leagues", authorizePermission("games:read"), listLeagues);
router.post("/leagues", authorizePermission("games:manage"), createLeague);
router.put("/leagues/:id", authorizePermission("games:manage"), updateLeague);

// Matches
router.get("/matches", authorizePermission("games:read"), listMatches);
router.get("/matches/:id", authorizePermission("games:read"), getMatch);
router.post("/matches", authorizePermission("games:manage"), createMatch);
router.put("/matches/:id", authorizePermission("games:manage"), updateMatch);
router.patch("/matches/:id/status", authorizePermission("games:manage"), updateMatchStatus);
router.patch("/matches/:id/result", authorizePermission("games:override_result"), overrideMatchResult);

// Odds
router.get("/matches/:matchId/odds", authorizePermission("games:read"), listOdds);
router.post("/matches/:matchId/odds", authorizePermission("games:manage"), createOdd);
router.put("/matches/:matchId/odds/bulk", authorizePermission("games:manage"), bulkUpsertOdds);
router.put("/odds/:id", authorizePermission("games:manage"), updateOdd);

export default router;
