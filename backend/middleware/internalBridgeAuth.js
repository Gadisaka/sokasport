/**
 * Shared secret gate for MRX (and future) server-to-server bridges.
 * Header: x-api-key === INTERNAL_BRIDGE_KEY
 *
 * @module middleware/internalBridgeAuth
 */

/**
 * @type {import("express").RequestHandler}
 */
export function verifyInternalBridgeKey(req, res, next) {
  const key = req.headers["x-api-key"];
  const expected = process.env.INTERNAL_BRIDGE_KEY;
  if (!expected || !key || key !== expected) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Invalid internal API key",
    });
  }
  next();
}
