/**
 * Public casino routes (no auth).
 *
 *   GET /api/casino/games              — enabled, ordered catalog (Redis cached)
 *   GET /api/casino/inout/demo-launch  — build a demo launch URL for the iframe
 *
 * Mounted before the authenticated casino router so these paths never hit the
 * auth middleware.
 *
 * @module routes/casinoPublic
 */
import express from "express";
import { prisma } from "../Config/db.js";
import { getCache, setCache } from "../services/cacheService.js";
import {
  INOUT_GAMES_CACHE_KEY,
  INOUT_GAMES_CACHE_TTL,
} from "../lib/inoutCatalogCache.js";
import { normalizeLang } from "../lib/inoutLang.js";
import { resolveCasinoEnabled } from "../lib/casinoSettings.js";
import {
  getInoutOperatorId,
  isInoutLaunchConfigured,
  INOUT_DEMO_OPERATOR_ID,
  INOUT_DEFAULT_COUNTRY,
  INOUT_LAUNCH_BASE_URL,
} from "../Config/inout.js";

const router = express.Router();

/**
 * GET /api/casino/status — public master switch state for the lobby.
 * When `enabled` is false the frontend renders a blank screen.
 */
router.get("/status", async (_req, res) => {
  try {
    const enabled = await resolveCasinoEnabled(prisma);
    return res.json({ enabled });
  } catch (error) {
    console.error("[casinoPublic] status error:", error);
    // Fail open so a settings/db hiccup doesn't black out the lobby.
    return res.json({ enabled: true });
  }
});

/** Shape returned to the frontend (no internal/admin fields). */
function toPublicGame(g) {
  return {
    gameMode: g.game_mode,
    title: g.title,
    description: g.description,
    iconUrl: g.icon_url,
    multiplayer: g.multiplayer,
    rtp: g.rtp,
  };
}

router.get("/games", async (_req, res) => {
  try {
    let data = await getCache(INOUT_GAMES_CACHE_KEY);
    if (!data) {
      const rows = await prisma.inoutGame.findMany({
        where: { enabled: true },
        orderBy: [{ sort_order: "asc" }, { title: "asc" }],
      });
      data = rows.map(toPublicGame);
      await setCache(INOUT_GAMES_CACHE_KEY, data, INOUT_GAMES_CACHE_TTL);
    }
    return res.json(data);
  } catch (error) {
    console.error("[casinoPublic] list games error:", error);
    return res.status(500).json({ message: "Failed to load games" });
  }
});

/**
 * GET /api/casino/inout/demo-launch?gameMode=&lang=
 * Demo/spectator mode — uses InOut's demo operator with currency=DEMO and our
 * operator id as themeId for branded loading. No auth, no wallet, no webhooks.
 */
router.get("/inout/demo-launch", (req, res) => {
  const gameMode = req.query.gameMode;
  if (!gameMode || typeof gameMode !== "string") {
    return res.status(400).json({ message: "gameMode is required" });
  }

  const countryCode = (
    typeof req.query.userCountryCode === "string" && req.query.userCountryCode
      ? req.query.userCountryCode
      : INOUT_DEFAULT_COUNTRY
  ).toUpperCase();

  const params = new URLSearchParams({
    gameMode,
    operatorId: INOUT_DEMO_OPERATOR_ID,
    currency: "DEMO",
    lang: normalizeLang(req.query.lang),
    userCountryCode: countryCode,
    adaptive: "true",
  });

  // Brand the demo loading screen with our theme when our operator id is set.
  if (isInoutLaunchConfigured()) {
    params.set("themeId", getInoutOperatorId());
  }

  const launchUrl = `${INOUT_LAUNCH_BASE_URL}?${params.toString()}`;
  return res.json({ launchUrl });
});

export default router;
