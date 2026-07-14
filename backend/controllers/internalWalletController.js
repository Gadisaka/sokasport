/**
 * Internal wallet bridge for MRX game platform.
 *
 * POST /api/internal/wallet/adjust-balance
 * Auth: x-api-key === INTERNAL_BRIDGE_KEY (no JWT).
 *
 * @module controllers/internalWalletController
 */
import { parseAdjustBalanceBody } from "../lib/mrxWalletRefs.js";
import {
  creditGameWinning,
  debitGameFee,
} from "../services/mrxWallet.js";

/**
 * @type {import("express").RequestHandler}
 */
export async function adjustBalance(req, res) {
  const parsed = parseAdjustBalanceBody(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ success: false, message: parsed.message });
  }

  const { phone, type, amount, referenceId } = parsed;

  try {
    const result =
      type === "GAME_FEE"
        ? await debitGameFee(phone, amount, referenceId)
        : await creditGameWinning(phone, amount, referenceId);

    switch (result.status) {
      case "ok":
      case "duplicate":
        return res.json({ success: true, newBalance: result.balance });
      case "insufficient_funds":
        return res.status(400).json({
          success: false,
          message: "Insufficient balance",
        });
      case "user_not_found":
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      case "no_wallet":
        return res.status(404).json({
          success: false,
          message: "Player wallet not found",
        });
      case "invalid_amount":
        return res.status(400).json({
          success: false,
          message: "amount must be a positive number",
        });
      default:
        return res.status(500).json({
          success: false,
          message: "Internal server error",
        });
    }
  } catch (err) {
    console.error("internal wallet adjust error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
}
