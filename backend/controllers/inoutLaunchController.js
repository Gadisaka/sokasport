/**
 * InOut Games launch controller (authenticated players).
 *
 * Issues a game-session token bound to the player and builds the iframe launch
 * URL. The token is later presented back to us on the init/bet/withdraw/
 * rollback webhooks as `token` (AuthToken). Since `init` does not return a
 * separate SessionToken, the same token is reused for all webhooks per the
 * provider spec.
 *
 * @module controllers/inoutLaunchController
 */
import crypto from "node:crypto";
import { prisma } from "../Config/db.js";
import {
  getInoutOperatorId,
  isInoutLaunchConfigured,
  INOUT_DEFAULT_CURRENCY,
  INOUT_DEFAULT_COUNTRY,
  INOUT_LAUNCH_BASE_URL,
} from "../Config/inout.js";
import { normalizeLang } from "../lib/inoutLang.js";

/** Session token validity window (advisory; see schema note). */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/casino/inout/launch
 * Body: { gameMode, lang?, userCountryCode?, lobbyUrl? }
 * Auth: player JWT (req.user.sub).
 * @type {import("express").RequestHandler}
 */
export async function createInoutLaunch(req, res) {
  try {
    if (!isInoutLaunchConfigured()) {
      return res.status(503).json({ message: "InOut integration not configured" });
    }

    if (req.user?.role !== "PLAYER") {
      return res.status(403).json({
        message: "Casino games are only available for player accounts.",
      });
    }

    const { gameMode, lang, userCountryCode, lobbyUrl } = req.body ?? {};
    if (!gameMode || typeof gameMode !== "string") {
      return res.status(400).json({ message: "gameMode is required" });
    }

    const wallet = await prisma.wallet.findFirst({
      where: { user_id: req.user.sub, wallet_type: "PLAYER" },
    });
    if (!wallet) {
      return res.status(400).json({ message: "No player wallet on this account." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    await prisma.inoutGameSession.create({
      data: {
        token,
        user_id: req.user.sub,
        currency: INOUT_DEFAULT_CURRENCY,
        game_mode: gameMode,
        expires_at: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    const params = new URLSearchParams({
      gameMode,
      operatorId: getInoutOperatorId(),
      authToken: token,
      currency: INOUT_DEFAULT_CURRENCY,
      lang: normalizeLang(lang),
      userCountryCode: (userCountryCode
        ? String(userCountryCode)
        : INOUT_DEFAULT_COUNTRY
      ).toUpperCase(),
      adaptive: "true",
    });
    if (lobbyUrl) {
      params.set("lobbyUrl", String(lobbyUrl));
    }

    const launchUrl = `${INOUT_LAUNCH_BASE_URL}?${params.toString()}`;
    return res.status(201).json({ launchUrl });
  } catch (error) {
    console.error("createInoutLaunch error:", error);
    return res.status(500).json({ message: "Failed to create game launch" });
  }
}
