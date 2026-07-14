/**
 * Player SSO token for MRX Instant Games launch.
 *
 * POST /api/player/generate-sso-token
 * Auth: player JWT (req.user.sub). PLAYER role only.
 *
 * @module controllers/playerSsoController
 */
import { prisma } from "../Config/db.js";
import { encryptMrxSsoToken } from "../lib/mrxSso.js";

/**
 * @type {import("express").RequestHandler}
 */
export async function generateSsoToken(req, res) {
  try {
    if (req.user?.role !== "PLAYER") {
      return res.status(403).json({
        success: false,
        message: "Instant games are only available for player accounts.",
      });
    }

    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const player = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, fullname: true, status: true },
    });

    if (!player || !player.status) {
      return res
        .status(404)
        .json({ success: false, message: "Player not found" });
    }
    if (!player.phone) {
      return res.status(400).json({
        success: false,
        message: "Player phone is required for game launch",
      });
    }

    // Same shape as MRX playerSso.js: phone as stored, name, timestamp
    const ssoToken = encryptMrxSsoToken({
      phone: player.phone,
      name: player.fullname || player.phone,
    });

    return res.json({ success: true, ssoToken });
  } catch (err) {
    console.error("generate-sso-token error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to generate SSO token",
    });
  }
}
